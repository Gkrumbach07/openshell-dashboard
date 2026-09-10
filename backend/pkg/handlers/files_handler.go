package handlers

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

const defaultUploadDir = "/sandbox"

func validateFilePath(p string) bool {
	if p == "" || strings.Contains(p, "\x00") || strings.Contains(p, "..") {
		return false
	}
	cleaned := filepath.Clean(p)
	return filepath.IsAbs(cleaned)
}

type FilesHandlerConfig struct {
	ExecTimeout   uint32
	MaxUploadSize int64
}

type FilesHandler struct {
	svc           services.FileServiceInterface
	execSvc       services.ExecServiceInterface
	sandboxes     services.SandboxServiceInterface
	execTimeout   uint32
	maxUploadSize int64
}

func NewFilesHandler(
	svc services.FileServiceInterface,
	execSvc services.ExecServiceInterface,
	cfg FilesHandlerConfig,
) *FilesHandler {
	return &FilesHandler{
		svc:           svc,
		execSvc:       execSvc,
		execTimeout:   cfg.ExecTimeout,
		maxUploadSize: cfg.MaxUploadSize,
	}
}

func (h *FilesHandler) execContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := h.execTimeout
	if timeout == 0 {
		timeout = 30
	}
	return context.WithTimeout(parent, time.Duration(timeout)*time.Second)
}

func resolveUploadDest(w http.ResponseWriter, destQuery, filename string) (string, bool) {
	if filename == "." || filename == ".." || filename == "/" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidFileName, "invalid filename")
		return "", false
	}
	dest := destQuery
	if dest == "" {
		dest = defaultUploadDir
	}
	if !validateFilePath(dest) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPath, "invalid destination directory")
		return "", false
	}
	destPath := filepath.Join(dest, filename)
	if !validateFilePath(destPath) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPath, "invalid destination path")
		return "", false
	}
	return destPath, true
}

func (h *FilesHandler) UploadFile(w http.ResponseWriter, r *http.Request) {
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")

	maxSize := h.maxUploadSize
	if maxSize == 0 {
		maxSize = 64 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)
	if parseErr := r.ParseMultipartForm(maxSize); parseErr != nil { //nolint:gosec // bounded by MaxBytesReader
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidUpload, "failed to parse multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.MissingFile, "file field is required")
		return
	}
	defer file.Close()

	destPath, ok := resolveUploadDest(w, r.URL.Query().Get("dest"), filepath.Base(header.Filename))
	if !ok {
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		apiutils.WriteError(w, http.StatusInternalServerError, apiutils.FileReadError, "failed to read uploaded file")
		return
	}

	// The SDK exposes no non-TTY stdin exec (Run has no stdin; Interactive
	// forces a PTY that corrupts binary payloads) and has no binary-safe upload
	// helper yet. Stream the bytes into `dd` over the gateway's non-TTY
	// ExecSandbox RPC via the dedicated raw client, resolving name -> sandbox
	// UUID first.
	ctx, cancel := h.execContext(r.Context())
	defer cancel()

	sandbox, err := h.sandboxes.Get(ctx, workspace, name)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}

	stdout, exitCode, execErr := h.svc.ExecWithStdin(ctx, sandbox.ID, []string{"dd", "of=" + destPath, "bs=4096"}, fileBytes)
	if execErr != nil {
		apiutils.WriteSDKError(w, execErr)
		return
	}
	if exitCode != 0 {
		slog.Error("file upload failed", "path", destPath, "exitCode", exitCode, "stdout", stdout)
		apiutils.WriteError(w, http.StatusBadGateway, apiutils.FileUploadFailed, "file upload failed")
		return
	}

	apiutils.WriteJSON(w, http.StatusOK, map[string]any{
		"exitCode": 0,
		"path":     destPath,
		"size":     len(fileBytes),
		"stdout":   stdout,
		"success":  true,
	})
}

func (h *FilesHandler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")
	filePath := r.URL.Query().Get("path")

	if !validateFilePath(filePath) {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPath, "path must be an absolute path without traversal")
		return
	}

	ctx, cancel := h.execContext(r.Context())
	defer cancel()

	result, err := h.execSvc.Run(ctx, workspace, name, []string{"cat", filePath})
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	if result.ExitCode != 0 {
		slog.Error("file download failed", "path", filePath, "exitCode", result.ExitCode, "stderr", string(result.Stderr))
		apiutils.WriteError(w, http.StatusNotFound, apiutils.FileNotFound, "file download failed")
		return
	}

	filename := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Stdout)))
	_, _ = w.Write(result.Stdout) //nolint:gosec // Content-Type is application/octet-stream, not HTML
}
