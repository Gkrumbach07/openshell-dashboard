package api

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

func (app *App) execContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := app.execTimeout
	if timeout == 0 {
		timeout = 30
	}
	return context.WithTimeout(parent, time.Duration(timeout)*time.Second)
}

func resolveUploadDest(w http.ResponseWriter, destQuery, filename string) (string, bool) {
	if filename == "." || filename == ".." || filename == "/" {
		writeError(w, http.StatusBadRequest, "invalid_filename", "invalid filename")
		return "", false
	}
	dest := destQuery
	if dest == "" {
		dest = defaultUploadDir
	}
	if !validateFilePath(dest) {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination directory")
		return "", false
	}
	destPath := filepath.Join(dest, filename)
	if !validateFilePath(destPath) {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination path")
		return "", false
	}
	return destPath, true
}

type uploadSession interface {
	io.Reader
	io.Writer
	Close() error
	ExitCode() (int, error)
}

func pipeUpload(session uploadSession, fileBytes []byte) (stdout string, exitCode int, err error) {
	var stdoutBuf bytes.Buffer
	drainDone := make(chan struct{})
	go func() {
		defer close(drainDone)
		_, _ = io.Copy(&stdoutBuf, session)
	}()

	if _, writeErr := session.Write(fileBytes); writeErr != nil && writeErr != io.EOF {
		_ = session.Close()
		<-drainDone
		return stdoutBuf.String(), 0, writeErr
	}
	if closeErr := session.Close(); closeErr != nil {
		<-drainDone
		return stdoutBuf.String(), 0, closeErr
	}
	<-drainDone

	if code, exitErr := session.ExitCode(); exitErr == nil {
		exitCode = code
	}
	return stdoutBuf.String(), exitCode, nil
}

func (app *App) UploadFile(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	maxSize := app.maxUploadSize
	if maxSize == 0 {
		maxSize = 64 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)
	if parseErr := r.ParseMultipartForm(maxSize); parseErr != nil { //nolint:gosec // bounded by MaxBytesReader
		writeError(w, http.StatusBadRequest, "invalid_upload", "failed to parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing_file", "file field is required")
		return
	}
	defer file.Close()

	destPath, ok := resolveUploadDest(w, r.URL.Query().Get("dest"), filepath.Base(header.Filename))
	if !ok {
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "failed to read uploaded file")
		return
	}

	// Files().Upload is a stub in this SDK build (defaultSSHTransport.available
	// is always false). Pipe bytes into dd via Interactive stdin, matching the
	// pre-migration ExecSandbox contract.
	ctx, cancel := app.execContext(r.Context())
	defer cancel()

	session, err := app.sdk.Exec().Interactive(ctx, workspace, name, []string{"dd", "of=" + destPath, "bs=4096"}, defaultTerminalCols, defaultTerminalRows)
	if err != nil {
		writeSDKError(w, err)
		return
	}

	stdout, exitCode, pipeErr := pipeUpload(session, fileBytes)
	if pipeErr != nil {
		writeSDKError(w, pipeErr)
		return
	}
	if exitCode != 0 {
		slog.Error("file upload failed", "path", destPath, "exitCode", exitCode, "stdout", stdout)
		writeError(w, http.StatusBadGateway, "upload_failed", "file upload failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"exitCode": 0,
		"path":     destPath,
		"size":     len(fileBytes),
		"stdout":   stdout,
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

	ctx, cancel := app.execContext(r.Context())
	defer cancel()

	result, err := app.sdk.Exec().Run(ctx, workspace, name, []string{"cat", filePath})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	if result.ExitCode != 0 {
		slog.Error("file download failed", "path", filePath, "exitCode", result.ExitCode, "stderr", string(result.Stderr))
		writeError(w, http.StatusNotFound, "file_not_found", "file download failed")
		return
	}

	filename := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Stdout)))
	_, _ = w.Write(result.Stdout) //nolint:gosec // Content-Type is application/octet-stream, not HTML
}
