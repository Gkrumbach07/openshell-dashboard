package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
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

	tmp, err := os.CreateTemp("", "upload-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "temp_error", "failed to create temp file")
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	size, err := io.Copy(tmp, file)
	if err != nil {
		tmp.Close()
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read uploaded file")
		return
	}
	if err := tmp.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "temp_error", "failed to close temp file")
		return
	}

	if err := app.sdk.Files().Upload(r.Context(), workspace, name, tmpName, destPath); err != nil {
		writeSDKError(w, err)
		return
	}

	// Preserve the existing JSON contract (previously populated from Exec dd).
	writeJSON(w, http.StatusOK, map[string]any{
		"exitCode": 0,
		"path":     destPath,
		"size":     size,
		"stdout":   "",
		"success":  true,
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

	tmp, err := os.CreateTemp("", "download-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "temp_error", "failed to create temp file")
		return
	}
	tmpName := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpName)

	if err := app.sdk.Files().Download(r.Context(), workspace, name, filePath, tmpName); err != nil {
		writeSDKError(w, err)
		return
	}

	data, err := os.ReadFile(tmpName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read downloaded file")
		return
	}

	filename := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data) //nolint:gosec // Content-Type is application/octet-stream, not HTML
}
