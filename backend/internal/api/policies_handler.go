package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

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
		slog.Error("invalid policy specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "invalid policy specification")
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
		slog.Error("invalid policy specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "invalid policy specification")
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
