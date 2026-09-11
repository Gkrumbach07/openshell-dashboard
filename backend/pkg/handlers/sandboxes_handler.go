package handlers

import (
	"log/slog"
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type SandboxHandler struct {
	svc services.SandboxServiceInterface
}

func NewSandboxHandler(svc services.SandboxServiceInterface) *SandboxHandler {
	return &SandboxHandler{
		svc: svc,
	}
}

func (h *SandboxHandler) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	sandboxes, err := h.svc.List(r.Context(), r.PathValue("workspace"), opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.Sandbox, 0, len(sandboxes))
	for _, sandbox := range sandboxes {
		out = append(out, models.FromSDKSandbox(sandbox))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *SandboxHandler) CreateSandbox(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.Name != "" && !apiutils.ValidDNS1123(body.Name) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidName, "sandbox name must be a valid DNS-1123 label")
		return
	}
	if body.Image == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidImage, "image is required")
		return
	}
	if len(body.Policy) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy is required — SandboxSpec.policy is a required field")
		return
	}
	spec, err := models.BuildSDKSandboxSpec(body)
	if err != nil {
		slog.Error("invalid sandbox specification", "error", err)
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "invalid sandbox specification")
		return
	}

	var createOpts []openshell.CreateOptions
	if len(body.Annotations) > 0 {
		createOpts = append(createOpts, openshell.CreateOptions{Annotations: body.Annotations})
	}

	sandbox, err := h.svc.Create(r.Context(), r.PathValue("workspace"), body.Name, spec, body.Labels, createOpts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKSandbox(sandbox))
}

func (h *SandboxHandler) GetSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := h.svc.Get(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}

// StopSandbox stops a running sandbox while retaining its persistent state.
// The sandbox transitions through STOPPING to STOPPED and can be resumed with
// StartSandbox.
func (h *SandboxHandler) StopSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := h.svc.Stop(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}

// StartSandbox resumes a previously stopped sandbox. The sandbox transitions
// through STARTING back to READY.
func (h *SandboxHandler) StartSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := h.svc.Start(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}

func (h *SandboxHandler) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	// SDK Delete returns nil error only on successful deletion. If the sandbox
	// doesn't exist, NotFound is returned (mapped to 404 by writeSDKError).
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
