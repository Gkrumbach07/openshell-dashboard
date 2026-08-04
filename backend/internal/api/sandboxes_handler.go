package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	sandboxes, err := app.gateway.ListSandboxes(r.Context(), chi.URLParam(r, "workspace"), 0, 0, r.URL.Query().Get("labelSelector"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.Sandbox, 0, len(sandboxes))
	for _, sandbox := range sandboxes {
		out = append(out, models.FromSandbox(sandbox))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) CreateSandbox(w http.ResponseWriter, r *http.Request) {
	var body models.CreateSandboxRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name != "" && !validDNS1123(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_name", "sandbox name must be a valid DNS-1123 label")
		return
	}
	if body.Image == "" {
		writeError(w, http.StatusBadRequest, "invalid_image", "image is required")
		return
	}
	if len(body.Policy) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "policy is required — SandboxSpec.policy is a required field")
		return
	}
	spec, err := models.BuildSandboxSpec(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_spec", err.Error())
		return
	}
	sandbox, err := app.gateway.CreateSandbox(r.Context(), chi.URLParam(r, "workspace"), body.Name, spec, body.Labels, body.Annotations)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSandbox(sandbox))
}

func (app *App) GetSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := app.gateway.GetSandbox(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSandbox(sandbox))
}

func (app *App) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteSandbox(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}
