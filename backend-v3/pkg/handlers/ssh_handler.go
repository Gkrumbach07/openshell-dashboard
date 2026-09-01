package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/ssh"
)

// SSHHandler translates HTTP requests into ssh.Service calls. Covers the
// SDK's SSHInterface (client.SSH()). Mounted under
// /api/sandboxes/{name}/ssh -- see pkg/server.
type SSHHandler struct {
	*Handler
	service ssh.Service
}

// NewSSHHandler wires an SSHHandler around the given service.
func NewSSHHandler(service ssh.Service) *SSHHandler {
	return &SSHHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. r is expected to
// already carry the "name" URL param for the parent sandbox.
func (h *SSHHandler) RegisterRoutes(r chi.Router) {
	r.Post("/session", h.CreateSession)
	r.Delete("/session/{token}", h.RevokeSession)
	// Tunnel is a raw bidirectional byte stream; needs a WebSocket
	// upgrade, not yet wired up.
	r.Get("/tunnel", h.notImplemented)
}

func (h *SSHHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")

	session, err := h.service.CreateSession(r.Context(), workspace, sandboxName)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusCreated, session)
}

func (h *SSHHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	token := chi.URLParam(r, "token")

	revoked, err := h.service.RevokeSession(r.Context(), workspace, token)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]bool{"revoked": revoked})
}
