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
	services, err := app.gateway.ListServices(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.ServiceEndpoint, 0, len(services))
	for _, svc := range services {
		out = append(out, models.FromServiceEndpointResponse(svc))
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
	resp, err := app.gateway.ExposeService(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), body.Service, body.TargetPort, body.Domain)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.FromServiceEndpointResponse(resp))
}

func (app *App) DeleteService(w http.ResponseWriter, r *http.Request) {
	deleted, err := app.gateway.DeleteService(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "svc"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}
