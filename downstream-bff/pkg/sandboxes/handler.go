package sandboxes

import (
	"errors"
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
)

// Handler is the HTTP entrypoint for this BFF's sandbox routes. Unlike
// Provider (see cmd/api/main.go, which reuses backend-v2's
// provider.NewProviderHandler unmodified), this handler is rewritten
// rather than reused, because it depends on ExtendedService — this
// package's own interface — not sandbox.Service. backend-v2's
// SandboxHandler has no way to accept ExtendedService or to know about
// RestartSandbox at all, so a handler that exposes it has to live here.
type Handler struct {
	*httpx.Handler
	service ExtendedService
}

// NewHandler builds a sandboxes Handler backed by an ExtendedService.
func NewHandler(base *httpx.Handler, service ExtendedService) *Handler {
	return &Handler{Handler: base, service: service}
}

// RegisterRoutes mounts sandbox routes under prefix, e.g.
// "/api/v1/workspaces/{workspace}/sandboxes", including /{name}/restart —
// a route backend-v2's own SandboxHandler doesn't and can't have.
func (h *Handler) RegisterRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix, h.handleList)
	mux.HandleFunc("POST "+prefix, h.handleCreate)
	mux.HandleFunc("GET "+prefix+"/{name}", h.handleGet)
	mux.HandleFunc("DELETE "+prefix+"/{name}", h.handleDelete)
	mux.HandleFunc("POST "+prefix+"/{name}/restart", h.handleRestart)
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

// handleRestart calls RestartSandbox — the method that doesn't exist on
// backend-v2's sandbox.Service at all. This route is the entire reason
// this handler couldn't just reuse backend-v2's SandboxHandler.
func (h *Handler) handleRestart(w http.ResponseWriter, r *http.Request) {
	if err := h.service.RestartSandbox(r.Context(), r.PathValue("workspace"), r.PathValue("name")); err != nil {
		h.WriteError(w, http.StatusBadGateway, "gateway_error", err.Error())
		return
	}
	h.WriteJSON(w, http.StatusOK, map[string]bool{"restarted": true})
}
