package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/inference"
)

// InferenceHandler translates HTTP requests into inference.Service calls.
// Covers the SDK's InferenceInterface (client.Inference()). Mounted at
// /api/inference.
type InferenceHandler struct {
	*Handler
	service inference.Service
}

// NewInferenceHandler wires an InferenceHandler around the given service.
func NewInferenceHandler(service inference.Service) *InferenceHandler {
	return &InferenceHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *InferenceHandler) RegisterRoutes(r chi.Router) {
	r.Post("/routes", h.SetRoute)
	r.Get("/routes/{routeName}", h.GetRoute)
	r.Delete("/routes/{routeName}", h.DeleteRoute)
	// Empty routeName represents the default user-facing route.
	r.Get("/routes", h.GetDefaultRoute)
	r.Delete("/routes", h.DeleteDefaultRoute)
}

func (h *InferenceHandler) SetRoute(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var cfg models.InferenceRouteConfig
	if err := h.decodeJSON(r, &cfg); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	route, err := h.service.SetRoute(r.Context(), workspace, &cfg)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, route)
}

func (h *InferenceHandler) GetRoute(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	routeName := chi.URLParam(r, "routeName")

	route, err := h.service.GetRoute(r.Context(), workspace, routeName)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, route)
}

func (h *InferenceHandler) DeleteRoute(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	routeName := chi.URLParam(r, "routeName")

	if err := h.service.DeleteRoute(r.Context(), workspace, routeName); err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *InferenceHandler) GetDefaultRoute(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	route, err := h.service.GetRoute(r.Context(), workspace, "")
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, route)
}

func (h *InferenceHandler) DeleteDefaultRoute(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	if err := h.service.DeleteRoute(r.Context(), workspace, ""); err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}
