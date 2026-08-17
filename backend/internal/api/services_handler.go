package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

type ExposeServiceRequest struct {
	Service    string `json:"service"`
	TargetPort uint32 `json:"targetPort"`
	Domain     bool   `json:"domain"`
}

func (app *App) ListServices(w http.ResponseWriter, r *http.Request) {
	services, err := app.sdk.Services().List(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.ServiceEndpoint, 0, len(services))
	for _, svc := range services {
		out = append(out, models.FromSDKServiceEndpoint(svc))
	}
	writeJSON(w, http.StatusOK, out)
}

func (app *App) ExposeService(w http.ResponseWriter, r *http.Request) {
	var body ExposeServiceRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Service == "" {
		writeError(w, http.StatusBadRequest, "invalid_service", "service name is required")
		return
	}
	if body.TargetPort == 0 {
		writeError(w, http.StatusBadRequest, "invalid_port", "targetPort must be greater than 0")
		return
	}
	svc, err := app.sdk.Services().Expose(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), body.Service, body.TargetPort, body.Domain)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromSDKServiceEndpoint(svc))
}

func (app *App) DeleteService(w http.ResponseWriter, r *http.Request) {
	if err := app.sdk.Services().Delete(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "svc")); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
