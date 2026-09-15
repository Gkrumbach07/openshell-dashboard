package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

// UpdatePolicyRequest carries the full replacement policy as JSON.
// Sandbox-scoped updates may only change network_policies and inference
// fields — filesystem/landlock/process must match the create-time policy.
type UpdatePolicyRequest struct {
	Policy                  json.RawMessage `json:"policy"`
	ExpectedResourceVersion uint64          `json:"expectedResourceVersion,omitempty"`
}

type PoliciesHandler struct {
	svc       services.PolicyServiceInterface
	configSvc services.ConfigServiceInterface
}

func NewPoliciesHandler(
	svc services.PolicyServiceInterface,
	configSvc services.ConfigServiceInterface,
) *PoliciesHandler {
	return &PoliciesHandler{
		svc:       svc,
		configSvc: configSvc,
	}
}

// GetSandboxPolicy returns the latest revision, active version, and revision
// history for a sandbox. Policy().List omits ListSandboxPoliciesRequest.Name
// (SDK gap), so history is reconstructed with GetStatus(WithVersion).
func (h *PoliciesHandler) GetSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")
	ctx := r.Context()

	status, err := h.svc.GetStatus(ctx, workspace, name)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}

	view := models.FromSDKPolicyStatus(status)
	latest := models.FromSDKPolicyRevision(&status.Revision)
	n := status.Revision.Version
	view.Revisions = make([]models.PolicyRevision, 0, n)

	// Policy().List omits sandbox name, so history is GetStatus(WithVersion)
	// per revision. Fetch older versions in parallel; keep latest from the
	// first GetStatus to avoid a redundant round-trip.
	if n > 1 {
		historical := make([]models.PolicyRevision, n-1)
		var wg sync.WaitGroup
		for v := uint32(1); v < n; v++ {
			wg.Add(1)
			go func(v uint32) {
				defer wg.Done()
				revStatus, revErr := h.svc.GetStatus(ctx, workspace, name, openshell.WithVersion(v))
				if revErr != nil {
					slog.Warn("sandbox policy revision unavailable",
						"workspace", workspace, "sandbox", name, "version", v, "error", revErr)
					return
				}
				historical[v-1] = models.FromSDKPolicyRevision(&revStatus.Revision)
			}(v)
		}
		wg.Wait()
		for _, rev := range historical {
			if rev.Version != 0 {
				view.Revisions = append(view.Revisions, rev)
			}
		}
	}
	if n >= 1 {
		view.Revisions = append(view.Revisions, latest)
	}
	apiutils.WriteJSON(w, http.StatusOK, view)
}

// UpdateSandboxPolicy applies a policy update to a sandbox via Config.Update.
func (h *PoliciesHandler) UpdateSandboxPolicy(w http.ResponseWriter, r *http.Request) {
	var body UpdatePolicyRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if len(body.Policy) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy is required")
		return
	}
	policy, err := models.ParseSDKPolicy(body.Policy)
	if err != nil {
		slog.Error("invalid policy specification", "error", err)
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := h.configSvc.Update(r.Context(), r.PathValue("workspace"), &openshell.ConfigUpdate{
		Name:                    r.PathValue("name"),
		Policy:                  policy,
		ExpectedResourceVersion: body.ExpectedResourceVersion,
	})
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.Version,
		PolicyHash: result.PolicyHash,
	})
}

// GetGlobalPolicy returns gateway-global policy revisions (Platform Admin).
func (h *PoliciesHandler) GetGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	revisions, err := h.svc.List(r.Context(), "", openshell.WithListGlobal(true))
	if err != nil {
		apiutils.WriteSDKError(w, err)
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
	apiutils.WriteJSON(w, http.StatusOK, view)
}

// SetGlobalPolicy applies a gateway-global policy to all sandboxes in full
// (no merge). Platform Admin operation.
func (h *PoliciesHandler) SetGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	var body UpdatePolicyRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if len(body.Policy) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy is required")
		return
	}
	policy, err := models.ParseSDKPolicy(body.Policy)
	if err != nil {
		slog.Error("invalid policy specification", "error", err)
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy does not match the SandboxPolicy schema: "+err.Error())
		return
	}
	result, err := h.configSvc.Update(r.Context(), "", &openshell.ConfigUpdate{
		Policy: policy,
		Global: true,
	})
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.PolicyUpdateResult{
		Version:    result.Version,
		PolicyHash: result.PolicyHash,
	})
}

// DeleteGlobalPolicy removes the gateway-global policy lock, restoring
// sandbox-level policy control. Platform Admin operation.
func (h *PoliciesHandler) DeleteGlobalPolicy(w http.ResponseWriter, r *http.Request) {
	if _, err := h.configSvc.Update(r.Context(), "", &openshell.ConfigUpdate{
		Global:        true,
		DeleteSetting: true,
		SettingKey:    "policy",
	}); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
