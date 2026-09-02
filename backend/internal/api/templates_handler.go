package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// ListSandboxTemplates lists the reusable workload templates in a workspace.
func (app *App) ListSandboxTemplates(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	templates, err := app.sdk.SandboxTemplates().List(r.Context(), chi.URLParam(r, "workspace"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.SandboxTemplate, 0, len(templates))
	for _, t := range templates {
		out = append(out, models.FromSDKSandboxTemplate(t))
	}
	writeJSON(w, http.StatusOK, out)
}

// CreateSandboxTemplate creates a reusable workload template.
func (app *App) CreateSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxTemplateRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if !validDNS1123(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_name", "template name must be a valid DNS-1123 label")
		return
	}
	if body.Spec.Workload == nil || body.Spec.Workload.Image == "" {
		writeError(w, http.StatusBadRequest, "invalid_image", "spec.workload.image is required")
		return
	}
	template, err := app.sdk.SandboxTemplates().Create(r.Context(), chi.URLParam(r, "workspace"), models.BuildSDKSandboxWorkloadTemplate(body))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKSandboxTemplate(template))
}

// GetSandboxTemplate returns a single reusable workload template.
func (app *App) GetSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	template, err := app.sdk.SandboxTemplates().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKSandboxTemplate(template))
}

// DeleteSandboxTemplate deletes a reusable workload template. Sandboxes already
// created from it are not affected.
func (app *App) DeleteSandboxTemplate(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.sdk.SandboxTemplates().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

// CreateSandboxFromTemplate creates a sandbox from a named workload template.
// The request supplies only governance fields (policy, providers); the workload
// (image, environment, resources) comes from the template.
func (app *App) CreateSandboxFromTemplate(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxFromTemplateRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name != "" && !validDNS1123(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_name", "sandbox name must be a valid DNS-1123 label")
		return
	}
	if body.TemplateName == "" {
		writeError(w, http.StatusBadRequest, "invalid_template", "templateName is required")
		return
	}
	if len(body.Policy) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy is required — SandboxSpec.policy is a required field")
		return
	}
	spec, err := models.BuildSDKTemplateGovernanceSpec(body)
	if err != nil {
		slog.Error("invalid sandbox specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "invalid sandbox specification")
		return
	}

	var createOpts []openshell.CreateOptions
	if len(body.Annotations) > 0 {
		createOpts = append(createOpts, openshell.CreateOptions{Annotations: body.Annotations})
	}

	sandbox, err := app.sdk.CreateSandboxFromTemplate(r.Context(), chi.URLParam(r, "workspace"), body.Name, body.TemplateName, spec, body.Labels, createOpts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKSandbox(sandbox))
}
