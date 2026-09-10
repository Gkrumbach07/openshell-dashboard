package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/refresh"
)

// RefreshHandler translates HTTP requests into refresh.Service calls.
// Covers the SDK's RefreshInterface (client.Providers().Refresh()).
// Mounted at /api/refresh.
type RefreshHandler struct {
	*Handler
	service refresh.Service
}

// NewRefreshHandler wires a RefreshHandler around the given service.
func NewRefreshHandler(service refresh.Service) *RefreshHandler {
	return &RefreshHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *RefreshHandler) RegisterRoutes(r chi.Router) {
	r.Get("/{provider}/{credentialKey}", h.GetStatus)
	r.Post("/", h.Configure)
	r.Post("/{provider}/{credentialKey}/rotate", h.Rotate)
	r.Delete("/{provider}/{credentialKey}", h.Delete)
}

func (h *RefreshHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	providerName := chi.URLParam(r, "provider")
	credentialKey := chi.URLParam(r, "credentialKey")

	statuses, err := h.service.GetStatus(r.Context(), workspace, providerName, credentialKey)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, statuses)
}

func (h *RefreshHandler) Configure(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var cfg models.RefreshConfig
	if err := h.decodeJSON(r, &cfg); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	status, err := h.service.Configure(r.Context(), workspace, &cfg)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, status)
}

func (h *RefreshHandler) Rotate(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	providerName := chi.URLParam(r, "provider")
	credentialKey := chi.URLParam(r, "credentialKey")

	status, err := h.service.Rotate(r.Context(), workspace, providerName, credentialKey)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, status)
}

func (h *RefreshHandler) Delete(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	providerName := chi.URLParam(r, "provider")
	credentialKey := chi.URLParam(r, "credentialKey")

	deleted, err := h.service.Delete(r.Context(), workspace, providerName, credentialKey)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}
