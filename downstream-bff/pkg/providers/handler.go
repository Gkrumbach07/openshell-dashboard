// Package providers is a deliberate contrast with pkg/provisioning: this
// BFF has no planned customization for Provider, so it consumes
// backend-v2's provider.Service directly instead of building an
// anti-corruption layer for it. That's a real, valid choice — not every
// upstream dependency justifies the extra indirection — but it does mean
// this package (and anything that imports it) is exposed to any breaking
// change in backend-v2/pkg/provider, not just to one adapter file.
//
// Rule of thumb applied here: build the ACL (see pkg/provisioning) for
// domains you intend to diverge from or that are on your critical path;
// accept direct coupling for domains you're happy to move in lockstep
// with upstream on.
package providers

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/provider"
)

// Handler is a thin pass-through to upstream provider.Service.
type Handler struct {
	*httpx.Handler
	service provider.Service
}

func NewHandler(base *httpx.Handler, service provider.Service) *Handler {
	return &Handler{Handler: base, service: service}
}

// RegisterRoutes mounts provider routes under prefix, e.g.
// "/api/v1/workspaces/{workspace}/providers".
func (h *Handler) RegisterRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix, h.handleList)
	mux.HandleFunc("POST "+prefix, h.handleCreate)
	mux.HandleFunc("GET "+prefix+"/{name}", h.handleGet)
	mux.HandleFunc("DELETE "+prefix+"/{name}", h.handleDelete)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	providers, err := h.service.ListProviders(r.Context(), r.PathValue("workspace"))
	if err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, providers)
}

func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
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

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	p, err := h.service.GetProvider(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		h.WriteError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, p)
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteProvider(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
