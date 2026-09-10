package handlers

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/exec"
)

// ExecHandler translates HTTP requests into exec.Service calls. Covers the
// SDK's ExecInterface (client.Exec()). Mounted under
// /api/sandboxes/{name}/exec -- see pkg/server.
type ExecHandler struct {
	*Handler
	service exec.Service
}

// NewExecHandler wires an ExecHandler around the given service.
func NewExecHandler(service exec.Service) *ExecHandler {
	return &ExecHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. r is expected to
// already carry the "name" URL param for the parent sandbox (mounted as
// r.Route("/{name}/exec", execHandler.RegisterRoutes)).
func (h *ExecHandler) RegisterRoutes(r chi.Router) {
	r.Post("/", h.Run)
	r.Post("/stream", h.Stream)
	// Interactive needs a bidirectional, low-latency transport
	// (WebSocket); not yet wired up.
	r.Get("/interactive", h.notImplemented)
}

type execRequest struct {
	Command []string `json:"command"`
}

func (h *ExecHandler) Run(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	var req execRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	result, err := h.service.Run(r.Context(), workspace, name, req.Command)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

// Stream runs a command and relays output chunks as Server-Sent Events
// until the command finishes.
func (h *ExecHandler) Stream(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	name := chi.URLParam(r, "name")

	var req execRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.WriteError(w, http.StatusBadRequest, err)
		return
	}

	stream, err := h.service.Stream(r.Context(), workspace, name, req.Command)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	defer func() { _ = stream.Close() }()

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.WriteError(w, http.StatusInternalServerError, errNoFlush)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	for {
		chunk, err := stream.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			h.logger.Error("exec stream failed", "error", err)
			return
		}

		if _, err := w.Write([]byte("data: {\"stream\":\"" + chunk.Stream + "\",\"data\":\"" +
			base64.StdEncoding.EncodeToString([]byte(chunk.Data)) + "\"}\n\n")); err != nil {
			return
		}
		flusher.Flush()
	}

	exitCode, err := stream.ExitCode()
	if err != nil {
		h.logger.Error("exec stream exit code failed", "error", err)
		return
	}
	if _, err := w.Write([]byte("event: exit\ndata: {\"exitCode\":" + strconv.Itoa(exitCode) + "}\n\n")); err != nil {
		return
	}
	flusher.Flush()
}
