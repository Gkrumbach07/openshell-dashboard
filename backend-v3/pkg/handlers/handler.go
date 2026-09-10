// Package handlers translates HTTP requests into calls on a service
package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// errNoFlush is returned when a streaming (SSE) handler's ResponseWriter
// doesn't support http.Flusher (shouldn't happen with net/http's default
// server, but middleware can wrap ResponseWriter in ways that break it).
var errNoFlush = errors.New("response writer does not support flushing")

// Handler holds fields every domain handler needs (currently just a
// logger). Embed *Handler in a domain handler to get those fields as
// first-class fields, e.g. h.logger, without repeating the plumbing.
type Handler struct {
	logger *slog.Logger
}

// newHandler builds a Handler, defaulting to slog.Default() when logger is
// nil.
func newHandler(logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{logger: logger}
}

// writeJSON encodes v as the JSON response body with the given status code.
func (h *Handler) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		h.logger.Error("encode response failed", "error", err)
	}
}

// WriteError maps err to an HTTP error response. Domain handlers call this
// on service errors; replace with richer status-code mapping (e.g. from
// SDK StatusError codes) as real client implementations land.
func (h *Handler) WriteError(w http.ResponseWriter, status int, err error) {
	http.Error(w, err.Error(), status)
}

// decodeJSON decodes the request body into v.
func (h *Handler) decodeJSON(r *http.Request, v any) error {
	defer func() { _ = r.Body.Close() }()
	return json.NewDecoder(r.Body).Decode(v)
}

// notImplemented is a stand-in handler for routes whose transport isn't
// wired up yet (e.g. operations needing a WebSocket upgrade for raw byte
// streams: SSH tunnels, TCP forwarding, interactive exec).
func (h *Handler) notImplemented(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}
