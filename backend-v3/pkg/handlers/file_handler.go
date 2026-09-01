package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/file"
)

// maxUploadBytes caps in-memory multipart parsing for uploads. Streaming
// uploads larger than this would need a different multipart-reading
// strategy (io.MultipartReader) than the convenience ParseMultipartForm
// used here.
const maxUploadBytes = 32 << 20 // 32 MiB

var errMissingRemotePath = errors.New("remotePath is required")

// FileHandler translates HTTP requests into file.Service calls. Covers the
// SDK's FileInterface (client.Files()). Mounted under
// /api/sandboxes/{name}/files -- see pkg/server.
type FileHandler struct {
	*Handler
	service file.Service
}

// NewFileHandler wires a FileHandler around the given service.
func NewFileHandler(service file.Service) *FileHandler {
	return &FileHandler{
		Handler: newHandler(nil),
		service: service,
	}
}

// RegisterRoutes mounts this handler's routes onto r. r is expected to
// already carry the "name" URL param for the parent sandbox.
func (h *FileHandler) RegisterRoutes(r chi.Router) {
	r.Post("/", h.Upload)
	r.Get("/", h.Download)
}

// Upload accepts a multipart form with a "file" part and a "remotePath"
// field, and streams the file into the sandbox.
func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")

	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	remotePath := r.FormValue("remotePath")
	if remotePath == "" {
		h.writeError(w, http.StatusBadRequest, errMissingRemotePath)
		return
	}

	f, _, err := r.FormFile("file")
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	defer func() { _ = f.Close() }()

	if err := h.service.Upload(r.Context(), workspace, sandboxName, remotePath, f); err != nil {
		h.writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.writeJSON(w, http.StatusNoContent, nil)
}

// Download streams the sandbox file at ?remotePath= back as the response
// body.
func (h *FileHandler) Download(w http.ResponseWriter, r *http.Request) {
	workspace := r.URL.Query().Get("workspace")
	sandboxName := chi.URLParam(r, "name")
	remotePath := r.URL.Query().Get("remotePath")
	if remotePath == "" {
		h.writeError(w, http.StatusBadRequest, errMissingRemotePath)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	if err := h.service.Download(r.Context(), workspace, sandboxName, remotePath, w); err != nil {
		// Headers may already be flushed if streaming had started; best
		// effort only.
		h.logger.Error("file download failed", "error", err)
		return
	}
}
