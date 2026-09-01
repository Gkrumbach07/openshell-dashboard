package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/endpoint"
)

// EndpointHandler translates HTTP requests into endpoint.Service calls.
// Covers the SDK's ServiceInterface (client.Services()). Mounted under
// /api/sandboxes/{name}/services -- see pkg/server.
type EndpointHandler struct {
	*Handler
	service endpoint.Service
}

// NewEndpointHandler wires an EndpointHandler around the given service.
func NewEndpointHandler(service endpoint.Service) *EndpointHandler {
	return &EndpointHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. r is expected to
// already carry the "name" URL param for the parent sandbox.
func (h *EndpointHandler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Expose)
	r.Get("/{serviceName}", h.Get)
	r.Delete("/{serviceName}", h.Delete)
}

func (h *EndpointHandler) List(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")

	services, err := h.service.List(r.Context(), workspace, sandboxName)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, services)
}

func (h *EndpointHandler) Get(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")
	serviceName := chi.URLParam(r, "serviceName")

	svc, err := h.service.Get(r.Context(), workspace, sandboxName, serviceName)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, svc)
}

func (h *EndpointHandler) Expose(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")

	var req struct {
		ServiceName string `json:"serviceName"`
		TargetPort  uint32 `json:"targetPort"`
		Domain      bool   `json:"domain,omitempty"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	svc, err := h.service.Expose(r.Context(), workspace, sandboxName, req.ServiceName, req.TargetPort, req.Domain)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusCreated, svc)
}

func (h *EndpointHandler) Delete(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")
	serviceName := chi.URLParam(r, "serviceName")

	if err := h.service.Delete(r.Context(), workspace, sandboxName, serviceName); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}
