package handlers

import (
	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/tcp"
)

// TCPHandler translates HTTP requests into tcp.Service calls. Covers (a
// subset of) the SDK's TCPInterface (client.TCP()). Mounted under
// /api/sandboxes/{name}/tcp -- see pkg/server.
//
// Forward is a raw bidirectional byte stream; it needs a WebSocket upgrade
// which isn't wired up yet, so this handler currently just registers a
// 501 stub. The service dependency is still threaded through so the route
// can be filled in without touching the wiring in pkg/server.
type TCPHandler struct {
	*Handler
	service tcp.Service
}

// NewTCPHandler wires a TCPHandler around the given service.
func NewTCPHandler(service tcp.Service) *TCPHandler {
	return &TCPHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. r is expected to
// already carry the "name" URL param for the parent sandbox.
func (h *TCPHandler) RegisterRoutes(r chi.Router) {
	r.Get("/forward", h.notImplemented)
}
