package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/encoding/protojson"

	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetSandboxPolicy returns the latest revision, active version, and revision
// history for a sandbox (GetSandboxPolicyStatus + ListSandboxPolicies).
func (app *App) GetSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	status, err := app.gateway.GetSandboxPolicyStatus(r.Context(), workspace, name, 0, false)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	list, err := app.gateway.ListSandboxPolicies(r.Context(), workspace, name, 0, 0, false)
	if err != nil {
		writeGrpcError(w, err)
		return
	}

	view := models.SandboxPolicyView{
		ActiveVersion: status.GetActiveVersion(),
		Revisions:     []models.PolicyRevision{},
	}
	if status.GetRevision() != nil {
		latest := models.FromPolicyRevision(status.GetRevision())
		view.Latest = &latest
	}
	for _, revision := range list.GetRevisions() {
		view.Revisions = append(view.Revisions, models.FromPolicyRevision(revision))
	}
	writeJSON(w, http.StatusOK, view)
}

// UpdatePolicyRequest carries the full replacement policy as protojson.
// Sandbox-scoped updates may only change network_policies and inference
// fields — filesystem/landlock/process must match the create-time policy.
type UpdatePolicyRequest struct {
	Policy                  json.RawMessage `json:"policy"`
	ExpectedResourceVersion uint64          `json:"expectedResourceVersion,omitempty"`
}

// UpdateSandboxPolicy applies a policy update to a sandbox via UpdateConfig.
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
	resp, err := app.gateway.UpdateSandboxPolicy(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), policy, body.ExpectedResourceVersion)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetVersion(),
		PolicyHash: resp.GetPolicyHash(),
	})
}

// GetGlobalPolicy returns gateway-global policy revisions (Platform Admin).
func (app *App) GetGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	list, err := app.gateway.ListSandboxPolicies(r.Context(), "", "", 0, 0, true)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	view := models.SandboxPolicyView{Revisions: []models.PolicyRevision{}}
	for _, revision := range list.GetRevisions() {
		view.Revisions = append(view.Revisions, models.FromPolicyRevision(revision))
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
	resp, err := app.gateway.SetGlobalPolicy(r.Context(), policy)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetVersion(),
		PolicyHash: resp.GetPolicyHash(),
	})
}

// DeleteGlobalPolicy removes the gateway-global policy lock, restoring
// sandbox-level policy control. Platform Admin operation.
func (app *App) DeleteGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	if err := app.gateway.DeleteGlobalPolicy(r.Context()); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// GetDraftPolicy returns the draft-policy inbox for a sandbox. Optional
// ?status=pending|approved|rejected filter.
func (app *App) GetDraftPolicy(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetDraftPolicy(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), r.URL.Query().Get("status"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftPolicy(resp))
}

// ApproveDraftChunk merges one proposed rule into the active policy.
func (app *App) ApproveDraftChunk(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.ApproveDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetPolicyVersion(),
		PolicyHash: resp.GetPolicyHash(),
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
	if _, err := app.gateway.RejectDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), body.Reason); err != nil {
		writeGrpcError(w, err)
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
	resp, err := app.gateway.ApproveAllDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), body.IncludeSecurityFlagged)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"policyVersion":  resp.GetPolicyVersion(),
		"policyHash":     resp.GetPolicyHash(),
		"chunksApproved": resp.GetChunksApproved(),
		"chunksSkipped":  resp.GetChunksSkipped(),
	})
}

// EditDraftChunkRequest carries the replacement proposed rule as protojson.
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
	rule := &sandboxv1.NetworkPolicyRule{}
	if err := protojson.Unmarshal(body.ProposedRule, rule); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_rule", "proposedRule does not match NetworkPolicyRule schema: "+err.Error())
		return
	}
	if err := app.gateway.EditDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"), rule); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"edited": true})
}

// UndoDraftChunk reverts an already-approved chunk, removing its rule from the
// active policy.
func (app *App) UndoDraftChunk(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.UndoDraftChunk(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "chunk"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    resp.GetPolicyVersion(),
		PolicyHash: resp.GetPolicyHash(),
	})
}

// ClearDraftChunks removes all pending draft chunks for a sandbox.
func (app *App) ClearDraftChunks(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.ClearDraftChunks(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chunksCleared": resp.GetChunksCleared(),
	})
}

// GetDraftHistory returns the chronological decision history for a sandbox's
// draft policy.
func (app *App) GetDraftHistory(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetDraftHistory(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromDraftHistory(resp))
}
