package api

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (app *App) UploadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()

	if parseErr := r.ParseMultipartForm(64 << 20); parseErr != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload", "failed to parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing_file", "file field is required")
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read uploaded file")
		return
	}

	dest := r.URL.Query().Get("dest")
	if dest == "" {
		dest = "/sandbox"
	}
	destPath := filepath.Join(dest, filepath.Base(header.Filename))

	stdout, stderr, exitCode, err := app.gateway.ExecSandbox(r.Context(), sandboxID,
		[]string{"sh", "-c", fmt.Sprintf("cat > %q", destPath)},
		fileBytes, "", 30)
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
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "missing_path", "path query parameter is required")
		return
	}

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()

	stdout, stderr, exitCode, err := app.gateway.ExecSandbox(r.Context(), sandboxID,
		[]string{"cat", filePath}, nil, "", 30)
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
	_, _ = w.Write(stdout)
}
