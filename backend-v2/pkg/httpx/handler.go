// Package httpx holds HTTP infrastructure shared across domain packages
// (pkg/sandbox, pkg/provider, ...): the base Handler (logger) and JSON
// request/response helpers. It is infrastructure, not a domain component, so
// it stays its own package rather than being duplicated per domain.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Handler holds fields every domain handler needs. Embed this, don't extend
// it with domain-specific fields.
type Handler struct {
	Logger *slog.Logger
}

// NewHandler builds the shared base. Domain handler constructors call this
// and embed the result.
func NewHandler(logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{Logger: logger}
}

// ErrorResponse is the standard error envelope, matching
// backend/internal/api.ErrorResponse.
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteJSON writes payload as the JSON response body with the given status.
// Exported: domain packages (pkg/sandbox, pkg/provider, ...) embed *Handler
// from outside this package, so these helpers must be exported to be usable.
func (h *Handler) WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		h.Logger.Error("encode response", "error", err)
	}
}

// WriteError writes a standard error envelope.
func (h *Handler) WriteError(w http.ResponseWriter, status int, code, message string) {
	h.WriteJSON(w, status, ErrorResponse{Code: code, Message: message})
}

// DecodeBody decodes the request body into dst, writing a 400 on failure.
// Returns false when the caller should stop handling the request.
func (h *Handler) DecodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		h.WriteError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return false
	}
	return true
}
