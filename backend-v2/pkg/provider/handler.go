package provider

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
)

// ProviderHandler is the HTTP entrypoint for Provider routes. Same shape as
// sandbox.SandboxHandler on purpose.
type ProviderHandler struct {
	*httpx.Handler
	service Service
}

// NewProviderHandler builds a ProviderHandler backed by service.
func NewProviderHandler(base *httpx.Handler, service Service) *ProviderHandler {
	return &ProviderHandler{Handler: base, service: service}
}

// RegisterRoutes mounts Provider routes on mux under the given prefix, e.g.
// "/api/v1/workspaces/{workspace}/providers".
func (h *ProviderHandler) RegisterRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix, h.handleList)
	mux.HandleFunc("POST "+prefix, h.handleCreate)
	mux.HandleFunc("GET "+prefix+"/{name}", h.handleGet)
	mux.HandleFunc("DELETE "+prefix+"/{name}", h.handleDelete)
}

func (h *ProviderHandler) handleList(w http.ResponseWriter, r *http.Request) {
	providers, err := h.service.ListProviders(r.Context(), r.PathValue("workspace"))
	if err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, providers)
}

func (h *ProviderHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req models.CreateProviderRequest
	if !h.DecodeBody(w, r, &req) {
		return
	}
	p, err := h.service.CreateProvider(r.Context(), r.PathValue("workspace"), req)
	if err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusCreated, p)
}

func (h *ProviderHandler) handleGet(w http.ResponseWriter, r *http.Request) {
	p, err := h.service.GetProvider(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		h.WriteError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, p)
}

func (h *ProviderHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteProvider(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
