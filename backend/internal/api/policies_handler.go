package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"
	sdktypes "github.com/rhuss/openshell-sdk-go/openshell/v1/types"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetSandboxPolicy returns the latest revision, active version, and revision
// history for a sandbox.
func (app *App) GetSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	status, err := app.client.Policy().GetStatus(r.Context(), workspace, name)
	if err != nil {
		writeSDKError(w, err)
		return
	}

	latest := models.FromPolicyRevision(&status.Revision)
	view := models.SandboxPolicyView{
		ActiveVersion: status.ActiveVersion,
		Latest:        &latest,
		Revisions:     []models.PolicyRevision{latest},
	}
	writeJSON(w, http.StatusOK, view)
}

// UpdatePolicyRequest carries the full replacement policy as JSON.
// Sandbox-scoped updates may only change network_policies and inference
// fields — filesystem/landlock/process must match the create-time policy.
type UpdatePolicyRequest struct {
	Policy                  json.RawMessage `json:"policy"`
	ExpectedResourceVersion uint64          `json:"expectedResourceVersion,omitempty"`
}

// UpdateSandboxPolicy applies a policy update to a sandbox via Config.Update.
func (app *App) UpdateSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	var body UpdatePolicyRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Policy) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy is required")
		return
	}
	policy, err := models.ParsePolicy(body.Policy)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := app.client.Config().Update(r.Context(), chi.URLParam(r, "workspace"), &openshell.ConfigUpdate{
		Name:                    chi.URLParam(r, "name"),
		Policy:                  policy,
		ExpectedResourceVersion: body.ExpectedResourceVersion,
	})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.Version,
		PolicyHash: result.PolicyHash,
	})
}

// GetGlobalPolicy returns gateway-global policy revisions (Platform Admin).
func (app *App) GetGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	revisions, err := app.client.Policy().List(r.Context(), "", sdktypes.WithListGlobal(true))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	view := models.SandboxPolicyView{Revisions: []models.PolicyRevision{}}
	for i := range revisions {
		view.Revisions = append(view.Revisions, models.FromPolicyRevision(&revisions[i]))
	}
	if len(view.Revisions) > 0 {
		view.Latest = &view.Revisions[0]
		view.ActiveVersion = view.Revisions[0].Version
	}
	writeJSON(w, http.StatusOK, view)
}

// SetGlobalPolicy applies a gateway-global policy to all sandboxes in full
// (no merge). Platform Admin operation.
func (app *App) SetGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	var body UpdatePolicyRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Policy) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy is required")
		return
	}
	policy, err := models.ParsePolicy(body.Policy)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := app.client.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
		Policy: policy,
		Global: true,
	})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.Version,
		PolicyHash: result.PolicyHash,
	})
}

// DeleteGlobalPolicy removes the gateway-global policy lock, restoring
// sandbox-level policy control. Platform Admin operation.
func (app *App) DeleteGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	_, err := app.client.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
		Global:        true,
		DeleteSetting: true,
		SettingKey:     "policy",
	})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// GetDraftPolicy returns the draft-policy inbox for a sandbox. Optional
// ?status=pending|approved|rejected filter.
func (app *App) GetDraftPolicy(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.GetDraftOption
	if status := r.URL.Query().Get("status"); status != "" {
		opts = append(opts, openshell.WithStatusFilter(status))
	}
	draft, err := app.client.Policy().GetDraft(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftPolicy(draft))
}

// ApproveDraftChunk merges one proposed rule into the active policy.
func (app *App) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	result, err := app.client.Policy().ApproveDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// RejectDraftChunkRequest carries the optional reviewer reason, surfaced back
// to the in-sandbox agent.
type RejectDraftChunkRequest struct {
	Reason string `json:"reason,omitempty"`
}

// RejectDraftChunk rejects one proposed rule.
func (app *App) RejectDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body RejectDraftChunkRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	if err := app.client.Policy().RejectDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), body.Reason); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"rejected": true})
}

// ApproveAllDraftChunksRequest mirrors the include_security_flagged option.
type ApproveAllDraftChunksRequest struct {
	IncludeSecurityFlagged bool `json:"includeSecurityFlagged,omitempty"`
}

// ApproveAllDraftChunks approves all pending chunks (security-flagged ones
// are skipped unless explicitly included).
func (app *App) ApproveAllDraftChunks(w http.ResponseWriter, r *http.Request) {
	var body ApproveAllDraftChunksRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	var opts []openshell.ApproveAllOption
	if body.IncludeSecurityFlagged {
		opts = append(opts, openshell.WithIncludeSecurityFlagged())
	}
	result, err := app.client.Policy().ApproveAllDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"policyVersion":  result.PolicyVersion,
		"policyHash":     result.PolicyHash,
		"chunksApproved": result.ChunksApproved,
		"chunksSkipped":  result.ChunksSkipped,
	})
}

// EditDraftChunkRequest carries the replacement proposed rule as JSON.
type EditDraftChunkRequest struct {
	ProposedRule json.RawMessage `json:"proposedRule"`
}

// EditDraftChunk replaces the proposed rule on a pending draft chunk.
func (app *App) EditDraftChunk(w http.ResponseWriter, r *http.Request) {
	var body EditDraftChunkRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.ProposedRule) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_rule", "proposedRule is required")
		return
	}
	rule, err := models.ParseNetworkPolicyRule(body.ProposedRule)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_rule", "proposedRule does not match NetworkPolicyRule schema: "+err.Error())
		return
	}
	if err := app.client.Policy().EditDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), rule); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"edited": true})
}

// UndoDraftChunk reverts an already-approved chunk, removing its rule from the
// active policy.
func (app *App) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	result, err := app.client.Policy().UndoDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.PolicyVersion,
		PolicyHash: result.PolicyHash,
	})
}

// ClearDraftChunks removes all pending draft chunks for a sandbox.
func (app *App) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	result, err := app.client.Policy().ClearDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chunksCleared": result.ChunksCleared,
	})
}

// GetDraftHistory returns the chronological decision history for a sandbox's
// draft policy.
func (app *App) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	entries, err := app.client.Policy().GetDraftHistory(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftHistory(entries))
}

