package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	var opts []openshell.ListOptions
	if sel := r.URL.Query().Get("labelSelector"); sel != "" {
		opts = append(opts, openshell.ListOptions{LabelSelector: sel})
	}
	sandboxes, err := app.sdk.Sandboxes().List(r.Context(), chi.URLParam(r, "workspace"), opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Sandbox, 0, len(sandboxes))
	for _, sandbox := range sandboxes {
		out = append(out, models.FromSDKSandbox(sandbox))
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
	spec, err := models.BuildSDKSandboxSpec(body)
	if err != nil {
		slog.Error("invalid sandbox specification", "error", err)
		writeError(w, http.StatusBadRequest, "invalid_policy", "invalid sandbox specification")
		return
	}

	var createOpts []openshell.CreateOptions
	if len(body.Annotations) > 0 {
		createOpts = append(createOpts, openshell.CreateOptions{Annotations: body.Annotations})
	}

	sandbox, err := app.sdk.Sandboxes().Create(r.Context(), chi.URLParam(r, "workspace"), body.Name, spec, body.Labels, createOpts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKSandbox(sandbox))
}

func (app *App) GetSandbox(w http.ResponseWriter, r *http.Request) {
	sandbox, err := app.sdk.Sandboxes().Get(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}

func (app *App) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	if err := app.sdk.Sandboxes().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name")); err != nil {
		writeSDKError(w, err)
		return
	}
	// SDK Delete returns nil error only on successful deletion. If the sandbox
	// doesn't exist, NotFound is returned (mapped to 404 by writeSDKError).
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
