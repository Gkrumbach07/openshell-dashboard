package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/provider"
)

// ProviderHandler translates HTTP requests into provider.Service calls.
// Covers the SDK's ProviderInterface (client.Providers()). Mounted at
// /api/providers.
type ProviderHandler struct {
	*Handler
	service provider.Service
}

// NewProviderHandler wires a ProviderHandler around the given service.
func NewProviderHandler(service provider.Service) *ProviderHandler {
	return &ProviderHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

func (h *ProviderHandler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{name}", h.Get)
	r.Put("/{name}", h.Update)
	r.Delete("/{name}", h.Delete)
	r.Post("/{name}/ensure", h.Ensure)
}

func (h *ProviderHandler) List(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	providers, err := h.service.List(r.Context(), workspace, models.ListOptions{})
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, providers)
}

func (h *ProviderHandler) Get(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	p, err := h.service.Get(r.Context(), workspace, name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, p)
}

func (h *ProviderHandler) Create(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var p models.Provider
	if err := h.decodeJSON(r, &p); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}

	created, err := h.service.Create(r.Context(), workspace, &p)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusCreated, created)
}

func (h *ProviderHandler) Update(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	var p models.Provider
	if err := h.decodeJSON(r, &p); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	p.Name = name

	updated, err := h.service.Update(r.Context(), workspace, &p)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, updated)
}

func (h *ProviderHandler) Delete(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	if err := h.service.Delete(r.Context(), workspace, name); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *ProviderHandler) Ensure(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	var p models.Provider
	if err := h.decodeJSON(r, &p); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	p.Name = name

	ensured, err := h.service.Ensure(r.Context(), workspace, &p)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, ensured)
}
