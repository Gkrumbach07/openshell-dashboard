package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/gateway"
)

type GatewayHandler struct {
	*Handler
	service gateway.Service
}

func NewGatewayHandler(service gateway.Service) *GatewayHandler {
	return &GatewayHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *GatewayHandler) RegisterRoutes(r chi.Router) {
	// r.Get("/", h.GetGatewayInfo)
	r.Get("/health", h.CheckHealth)
	r.Get("/me", h.GetCurrentUser)
	r.Get("/", h.GetGateways)
}

func (h *GatewayHandler) GetGateways(w http.ResponseWriter, r *http.Request) {
}

func (h *GatewayHandler) GetGatewayInfo(w http.ResponseWriter, r *http.Request) {
	info, err := h.service.GetGatewayInfo(r.Context())
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, info)
}

func (h *GatewayHandler) CheckHealth(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.CheckHealth(r.Context())
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *GatewayHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	user, err := h.service.GetCurrentUser(r.Context())
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, user)
}
