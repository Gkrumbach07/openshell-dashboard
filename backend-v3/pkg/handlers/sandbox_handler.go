package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/sandbox"
)

// SandboxHandler translates HTTP requests into sandbox.Service calls.
// Covers the SDK's SandboxInterface (client.Sandboxes()).
type SandboxHandler struct {
	*Handler
	service sandbox.Service
}

// NewSandboxHandler wires a SandboxHandler around the given service.
func NewSandboxHandler(service sandbox.Service) *SandboxHandler {
	return &SandboxHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. Called via
// r.Route("/sandboxes", sandboxHandler.RegisterRoutes) in pkg/server. Other
// per-sandbox sub-resources (exec, files, services, ssh, policy, ...) are
// mounted as sibling routers under the same "/sandboxes" prefix -- see
// pkg/server/server.go.
func (h *SandboxHandler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.ListSandboxes)
	r.Post("/", h.CreateSandbox)
	r.Get("/{name}", h.GetSandbox)
	r.Delete("/{name}", h.DeleteSandbox)
	r.Get("/{name}/logs", h.GetLogs)
	r.Get("/{name}/watch", h.WatchSandbox)
	r.Post("/{name}/providers/{provider}", h.AttachProvider)
	r.Delete("/{name}/providers/{provider}", h.DetachProvider)
	r.Get("/{name}/providers", h.ListProviders)
}

func (h *SandboxHandler) ListSandboxes(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	sandboxes, err := h.service.ListSandboxes(r.Context(), workspace)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, sandboxes)
}

func (h *SandboxHandler) GetSandbox(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	sb, err := h.service.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, sb)
}

func (h *SandboxHandler) CreateSandbox(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")

	var req struct {
		Name   string              `json:"name"`
		Spec   *models.SandboxSpec `json:"spec"`
		Labels map[string]string   `json:"labels,omitempty"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	sb, err := h.service.CreateSandbox(r.Context(), workspace, req.Name, req.Spec, req.Labels)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusCreated, sb)
}

func (h *SandboxHandler) DeleteSandbox(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	if err := h.service.DeleteSandbox(r.Context(), workspace, name); err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusNoContent, nil)
}

func (h *SandboxHandler) AttachProvider(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	provider := chi.URLParam(r, "provider")
	expectedResourceVersion, _ := strconv.ParseUint(r.URL.Query().Get("expectedResourceVersion"), 10, 64)

	result, err := h.service.AttachProvider(r.Context(), workspace, name, provider, expectedResourceVersion)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *SandboxHandler) DetachProvider(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")
	provider := chi.URLParam(r, "provider")
	expectedResourceVersion, _ := strconv.ParseUint(r.URL.Query().Get("expectedResourceVersion"), 10, 64)

	result, err := h.service.DetachProvider(r.Context(), workspace, name, provider, expectedResourceVersion)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *SandboxHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	providers, err := h.service.ListProviders(r.Context(), workspace, name)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, providers)
}

func (h *SandboxHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	var opts models.LogOptions
	if lines, err := strconv.ParseUint(r.URL.Query().Get("lines"), 10, 32); err == nil {
		opts.Lines = uint32(lines)
	}
	if minLevel := r.URL.Query().Get("minLevel"); minLevel != "" {
		opts.MinLevel = minLevel
	}

	result, err := h.service.GetLogs(r.Context(), workspace, name, opts)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

// WatchSandbox streams sandbox state-change events as Server-Sent Events.
// One event per line, JSON-encoded models.SandboxEvent payloads.
func (h *SandboxHandler) WatchSandbox(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	events, stop, err := h.service.Watch(r.Context(), workspace, name)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	defer stop()

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.WriteError(w, http.StatusInternalServerError, errNoFlush)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	enc := json.NewEncoder(w)
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if _, err := w.Write([]byte("data: ")); err != nil {
				return
			}
			if err := enc.Encode(event); err != nil {
				h.logger.Error("encode sandbox watch event failed", "error", err)
				return
			}
			if _, err := w.Write([]byte("\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
