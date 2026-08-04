package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetSandboxLogs serves the polled logs view. GetSandboxLogs (gRPC) takes
// sandbox_id, not name — the BFF resolves name → metadata.id via GetSandbox.
//
// Query params: lines (default 200), sinceMs, source (repeatable:
// gateway|sandbox), level (min level, e.g. INFO).
func (app *App) GetSandboxLogs(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()
	if sandboxID == "" {
		writeError(w, http.StatusNotFound, "not_found", "sandbox has no id")
		return
	}

	query := r.URL.Query()
	lines := uint32(200)
	if raw := query.Get("lines"); raw != "" {
		if parsed, parseErr := strconv.ParseUint(raw, 10, 32); parseErr == nil {
			lines = uint32(parsed)
		}
	}
	var sinceMs int64
	if raw := query.Get("sinceMs"); raw != "" {
		if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
			sinceMs = parsed
		}
	}

	resp, err := app.gateway.GetSandboxLogs(r.Context(), workspace, sandboxID, lines, sinceMs, query["source"], query.Get("level"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSandboxLogs(resp))
}

// ListSandboxProviders lists provider records attached to a sandbox.
func (app *App) ListSandboxProviders(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.ListSandboxProviders(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	out := make([]models.Provider, 0, len(resp.GetProviders()))
	for _, provider := range resp.GetProviders() {
		out = append(out, models.FromProvider(provider))
	}
	writeJSON(w, http.StatusOK, out)
}

// attachDetachRequest carries the optimistic-concurrency version from the
// caller's last read (0 skips the check).
type attachDetachRequest struct {
	ExpectedResourceVersion uint64 `json:"expectedResourceVersion,omitempty"`
}

// AttachSandboxProvider attaches a provider to a sandbox.
func (app *App) AttachSandboxProvider(w http.ResponseWriter, r *http.Request) {
	var body attachDetachRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	resp, err := app.gateway.AttachSandboxProvider(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "provider"), body.ExpectedResourceVersion)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"attached": resp.GetAttached(),
		"sandbox":  models.FromSandbox(resp.GetSandbox()),
	})
}

// DetachSandboxProvider detaches a provider from a sandbox.
func (app *App) DetachSandboxProvider(w http.ResponseWriter, r *http.Request) {
	var body attachDetachRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	resp, err := app.gateway.DetachSandboxProvider(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"), chi.URLParam(r, "provider"), body.ExpectedResourceVersion)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"detached": resp.GetDetached(),
		"sandbox":  models.FromSandbox(resp.GetSandbox()),
	})
}
