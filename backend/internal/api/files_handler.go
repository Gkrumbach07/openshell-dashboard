package api

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

const defaultUploadDir = "/sandbox"

func validateFilePath(p string) bool {
	if p == "" || strings.Contains(p, "\x00") || strings.Contains(p, "..") {
		return false
	}
	cleaned := filepath.Clean(p)
	return filepath.IsAbs(cleaned)
}

func (app *App) UploadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()

	r.Body = http.MaxBytesReader(w, r.Body, app.maxUploadSize)
	if parseErr := r.ParseMultipartForm(app.maxUploadSize); parseErr != nil { //nolint:gosec // bounded by MaxBytesReader
		writeError(w, http.StatusBadRequest, "invalid_upload", "failed to parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing_file", "file field is required")
		return
	}
	defer file.Close()

	filename := filepath.Base(header.Filename)
	if filename == "." || filename == ".." || filename == "/" {
		writeError(w, http.StatusBadRequest, "invalid_filename", "invalid filename")
		return
	}

	dest := r.URL.Query().Get("dest")
	if dest == "" {
		dest = defaultUploadDir
	}
	if !validateFilePath(dest) {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination directory")
		return
	}
	destPath := filepath.Join(dest, filename)
	if !validateFilePath(destPath) {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination path")
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read uploaded file")
		return
	}

	stdout, stderr, exitCode, err := app.gateway.ExecSandbox(r.Context(), sandboxID,
		[]string{"dd", "of=" + destPath, "bs=4096"},
		fileBytes, "", app.execTimeout)
	if err != nil {
		writeGrpcError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"exitCode": exitCode,
		"path":     destPath,
		"size":     len(fileBytes),
		"stdout":   string(stdout),
		"stderr":   string(stderr),
	})
}

func (app *App) DownloadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")
	filePath := r.URL.Query().Get("path")

	if !validateFilePath(filePath) {
		writeError(w, http.StatusBadRequest, "invalid_path", "path must be an absolute path without traversal")
		return
	}

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()

	stdout, stderr, exitCode, err := app.gateway.ExecSandbox(r.Context(), sandboxID,
		[]string{"cat", filePath}, nil, "", app.execTimeout)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	if exitCode != 0 {
		writeError(w, http.StatusNotFound, "file_not_found",
			fmt.Sprintf("cat exited %d: %s", exitCode, string(stderr)))
		return
	}

	filename := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(stdout)))
	_, _ = w.Write(stdout) //nolint:gosec // Content-Type is application/octet-stream, not HTML
}
