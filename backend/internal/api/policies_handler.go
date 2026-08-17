package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetSandboxPolicy returns the latest revision and active version for a sandbox.
// Policy().List has no sandbox-name filter, so revision history is the latest only.
func (app *App) GetSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	status, err := app.sdk.Policy().GetStatus(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKPolicyStatus(status))
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
	policy, err := models.ParseSDKPolicy(body.Policy)
	if err != nil {
		slog.Error("invalid policy specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := app.sdk.Config().Update(r.Context(), chi.URLParam(r, "workspace"), &openshell.ConfigUpdate{
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
	revisions, err := app.sdk.Policy().List(r.Context(), "", openshell.WithListGlobal(true))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	view := models.SandboxPolicyView{Revisions: []models.PolicyRevision{}}
	for i := range revisions {
		view.Revisions = append(view.Revisions, models.FromSDKPolicyRevision(&revisions[i]))
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
	policy, err := models.ParseSDKPolicy(body.Policy)
	if err != nil {
		slog.Error("invalid policy specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := app.sdk.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
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
	if _, err := app.sdk.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
		Global:        true,
		DeleteSetting: true,
		SettingKey:    "policy",
	}); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
