package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (app *App) UploadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload", "failed to parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing_file", "file field is required")
		return
	}
	defer file.Close()

	tmp, err := os.CreateTemp("", "upload-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "temp_error", "failed to create temp file")
		return
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	size, err := io.Copy(tmp, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read uploaded file")
		return
	}
	tmp.Close()

	dest := r.URL.Query().Get("dest")
	if dest == "" {
		dest = "/sandbox"
	}
	destPath := filepath.Join(dest, filepath.Base(header.Filename))

	if err := app.client.Files().Upload(r.Context(), workspace, name, tmp.Name(), destPath); err != nil {
		writeSDKError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path": destPath,
		"size": size,
	})
}

func (app *App) DownloadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "missing_path", "path query parameter is required")
		return
	}

	result, err := app.client.Exec().Run(r.Context(), workspace, name, []string{"cat", filePath})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	if result.ExitCode != 0 {
		writeError(w, http.StatusNotFound, "file_not_found",
			fmt.Sprintf("cat exited %d: %s", result.ExitCode, result.Stderr))
		return
	}

	filename := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Stdout)))
	w.Write([]byte(result.Stdout))
}
