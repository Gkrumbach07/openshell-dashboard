package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/config"
)

// ConfigHandler translates HTTP requests into config.Service calls. Covers
// the SDK's ConfigInterface (client.Config()). Mounted at /api/config.
type ConfigHandler struct {
	*Handler
	service config.Service
}

// NewConfigHandler wires a ConfigHandler around the given service.
func NewConfigHandler(service config.Service) *ConfigHandler {
	return &ConfigHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *ConfigHandler) RegisterRoutes(r chi.Router) {
	r.Get("/sandboxes/{name}", h.GetSandboxConfig)
	r.Get("/gateway", h.GetGatewayConfig)
	r.Put("/", h.Update)
}

func (h *ConfigHandler) GetSandboxConfig(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	cfg, err := h.service.GetSandboxConfig(r.Context(), workspace, name)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, cfg)
}

func (h *ConfigHandler) GetGatewayConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.service.GetGatewayConfig(r.Context())
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, cfg)
}

func (h *ConfigHandler) Update(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var update models.ConfigUpdate
	if err := h.decodeJSON(r, &update); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	result, err := h.service.Update(r.Context(), workspace, &update)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}
