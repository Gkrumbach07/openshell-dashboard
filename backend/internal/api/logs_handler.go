package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetSandboxLogs serves the polled logs view. The SDK resolves sandbox name
// to sandbox_id internally.
//
// Query params: lines (default 200), sinceMs, source (repeatable:
// gateway|sandbox), level (min level, e.g. INFO).
func (app *App) GetSandboxLogs(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	query := r.URL.Query()
	var opts []openshell.LogOption

	lines := uint32(200)
	if raw := query.Get("lines"); raw != "" {
		if parsed, parseErr := strconv.ParseUint(raw, 10, 32); parseErr == nil {
			lines = uint32(parsed)
		}
	}
	opts = append(opts, openshell.WithLogLines(lines))

	if raw := query.Get("sinceMs"); raw != "" {
		if ms, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
			opts = append(opts, openshell.WithLogSince(time.UnixMilli(ms)))
		}
	}
	if sources := query["source"]; len(sources) > 0 {
		opts = append(opts, openshell.WithLogSources(sources...))
	}
	if level := query.Get("level"); level != "" {
		opts = append(opts, openshell.WithLogMinLevel(level))
	}

	result, err := app.sdk.Sandboxes().GetLogs(r.Context(), workspace, name, opts...)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKSandboxLogs(result))
}

// ListSandboxProviders lists provider records attached to a sandbox.
func (app *App) ListSandboxProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := app.sdk.Sandboxes().ListProviders(r.Context(), chi.URLParam(r, "workspace"), chi.URLParam(r, "name"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := make([]models.Provider, 0, len(providers))
	for _, provider := range providers {
		out = append(out, models.FromSDKProvider(provider))
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
	result, err := app.sdk.Sandboxes().AttachProvider(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		chi.URLParam(r, "provider"),
		body.ExpectedResourceVersion,
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := map[string]any{"attached": result.Attached}
	if result.Sandbox != nil {
		out["sandbox"] = models.FromSDKSandbox(result.Sandbox)
	}
	writeJSON(w, http.StatusOK, out)
}

// DetachSandboxProvider detaches a provider from a sandbox.
func (app *App) DetachSandboxProvider(w http.ResponseWriter, r *http.Request) {
	var body attachDetachRequest
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	result, err := app.sdk.Sandboxes().DetachProvider(
		r.Context(),
		chi.URLParam(r, "workspace"),
		chi.URLParam(r, "name"),
		chi.URLParam(r, "provider"),
		body.ExpectedResourceVersion,
	)
	if err != nil {
		writeSDKError(w, err)
		return
	}
	out := map[string]any{"detached": result.Detached}
	if result.Sandbox != nil {
		out["sandbox"] = models.FromSDKSandbox(result.Sandbox)
	}
	writeJSON(w, http.StatusOK, out)
}
