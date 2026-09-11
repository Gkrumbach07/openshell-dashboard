package handlers

import (
	"log/slog"
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type TemplatesHandler struct {
	svc services.TemplateServiceInterface
}

func NewTemplatesHandler(svc services.TemplateServiceInterface) *TemplatesHandler {
	return &TemplatesHandler{
		svc: svc,
	}
}

// ListSandboxTemplates lists the reusable workload templates in a workspace.
func (h *TemplatesHandler) ListSandboxTemplates(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	templates, err := h.svc.List(r.Context(), r.PathValue("workspace"), opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.SandboxTemplate, 0, len(templates))
	for _, t := range templates {
		out = append(out, models.FromSDKSandboxTemplate(t))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

// CreateSandboxTemplate creates a reusable workload template.
func (h *TemplatesHandler) CreateSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxTemplateRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if !apiutils.ValidDNS1123(body.Name) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidName, "template name must be a valid DNS-1123 label")
		return
	}
	if body.Spec.Workload == nil || body.Spec.Workload.Image == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidImage, "spec.workload.image is required")
		return
	}
	template, err := h.svc.Create(r.Context(), r.PathValue("workspace"), models.BuildSDKSandboxWorkloadTemplate(body))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKSandboxTemplate(template))
}

// GetSandboxTemplate returns a single reusable workload template.
func (h *TemplatesHandler) GetSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	template, err := h.svc.Get(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandboxTemplate(template))
}

// DeleteSandboxTemplate deletes a reusable workload template. Sandboxes already
// created from it are not affected.
func (h *TemplatesHandler) DeleteSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.svc.Delete(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// CreateSandboxFromTemplate creates a sandbox from a named workload template.
// The request supplies only governance fields (policy, providers); the workload
// (image, environment, resources) comes from the template.
func (h *TemplatesHandler) CreateSandboxFromTemplate(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxFromTemplateRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.Name != "" && !apiutils.ValidDNS1123(body.Name) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidName, "sandbox name must be a valid DNS-1123 label")
		return
	}
	if body.TemplateName == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidTemplate, "templateName is required")
		return
	}
	if len(body.Policy) == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "policy is required — SandboxSpec.policy is a required field")
		return
	}
	spec, err := models.BuildSDKTemplateGovernanceSpec(body)
	if err != nil {
		slog.Error("invalid sandbox specification", "error", err)
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPolicy, "invalid sandbox specification")
		return
	}

	var createOpts []openshell.CreateOptions
	if len(body.Annotations) > 0 {
		createOpts = append(createOpts, openshell.CreateOptions{Annotations: body.Annotations})
	}

	sandbox, err := h.svc.CreateSandboxFromTemplate(r.Context(), r.PathValue("workspace"), body.Name, body.TemplateName, spec, body.Labels, createOpts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKSandbox(sandbox))
}
