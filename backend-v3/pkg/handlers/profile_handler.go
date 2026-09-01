package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/profile"
)

// ProfileHandler translates HTTP requests into profile.Service calls.
// Covers the SDK's ProfileInterface (client.Providers().Profiles()).
// Mounted at /api/profiles.
type ProfileHandler struct {
	*Handler
	service profile.Service
}

// NewProfileHandler wires a ProfileHandler around the given service.
func NewProfileHandler(service profile.Service) *ProfileHandler {
	return &ProfileHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *ProfileHandler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Get("/{id}", h.Get)
	r.Post("/import", h.Import)
	r.Put("/{id}", h.Update)
	r.Post("/lint", h.Lint)
	r.Delete("/{id}", h.Delete)
}

func (h *ProfileHandler) List(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	profiles, err := h.service.List(r.Context(), workspace, models.ListOptions{})
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, profiles)
}

func (h *ProfileHandler) Get(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	id := chi.URLParam(r, "id")

	p, err := h.service.Get(r.Context(), workspace, id)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, p)
}

func (h *ProfileHandler) Import(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var req struct {
		Items []models.ProfileImportItem `json:"items"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := h.service.Import(r.Context(), workspace, req.Items)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *ProfileHandler) Update(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	id := chi.URLParam(r, "id")
	expectedResourceVersion, _ := strconv.ParseUint(r.URL.Query().Get("expectedResourceVersion"), 10, 64)

	var item models.ProfileImportItem
	if err := h.decodeJSON(r, &item); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := h.service.Update(r.Context(), workspace, id, expectedResourceVersion, item)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *ProfileHandler) Lint(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var req struct {
		Items []models.ProfileImportItem `json:"items"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := h.service.Lint(r.Context(), workspace, req.Items)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, result)
}

func (h *ProfileHandler) Delete(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	id := chi.URLParam(r, "id")

	deleted, err := h.service.Delete(r.Context(), workspace, id)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}
