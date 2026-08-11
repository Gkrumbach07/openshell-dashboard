package sandboxes

import (
	"errors"
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

// Handler is a thin HTTP layer over a sandbox.Service — in practice a
// *QuotaEnforcer wrapping backend-v2's default implementation, but the
// handler only knows about the interface, same as backend-v2's own
// SandboxHandler.
type Handler struct {
	*httpx.Handler
	service sandbox.Service
}

// NewHandler builds a sandboxes Handler backed by service.
func NewHandler(base *httpx.Handler, service sandbox.Service) *Handler {
	return &Handler{Handler: base, service: service}
}

// RegisterRoutes mounts sandbox routes under prefix, e.g.
// "/api/v1/workspaces/{workspace}/sandboxes".
func (h *Handler) RegisterRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix, h.handleList)
	mux.HandleFunc("POST "+prefix, h.handleCreate)
	mux.HandleFunc("GET "+prefix+"/{name}", h.handleGet)
	mux.HandleFunc("DELETE "+prefix+"/{name}", h.handleDelete)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	sandboxes, err := h.service.ListSandboxes(r.Context(), r.PathValue("workspace"))
	if err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, sandboxes)
}

func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req models.CreateSandboxRequest
	if !h.DecodeBody(w, r, &req) {
		return
	}
	sb, err := h.service.CreateSandbox(r.Context(), r.PathValue("workspace"), req)
	if err != nil {
		if errors.Is(err, ErrQuotaExceeded) {
			h.WriteError(w, http.StatusTooManyRequests, "quota_exceeded", err.Error())
			return
		}
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusCreated, sb)
}

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	sb, err := h.service.GetSandbox(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		h.WriteError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, sb)
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteSandbox(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
