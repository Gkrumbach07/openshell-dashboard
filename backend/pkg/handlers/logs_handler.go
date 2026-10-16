package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	pb "github.com/NVIDIA/OpenShell/sdk/go/proto/openshellv1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type LogsHandler struct {
	sandboxSvc services.SandboxServiceInterface
	keys       services.ProviderCredentialKeyReader
}

func NewLogsHandler(svc services.SandboxServiceInterface) *LogsHandler {
	return &LogsHandler{sandboxSvc: svc}
}

// SetCredentialKeyReader gives the handler the way to read which credentials
// the providers attached to a sandbox hold; see
// ProvidersHandler.SetCredentialKeyReader. Call it before the handler serves
// requests.
func (h *LogsHandler) SetCredentialKeyReader(keys services.ProviderCredentialKeyReader) {
	h.keys = keys
}

// GetSandboxLogs serves the polled logs view. The gateway is asked by sandbox
// name and workspace; the SDK first checks that the sandbox exists.
//
// Query params: lines (default 200), sinceMs, source (repeatable:
// gateway|sandbox), level (min level, e.g. INFO).
func (h *LogsHandler) GetSandboxLogs(w http.ResponseWriter, r *http.Request) {
	workspace := r.PathValue("workspace")
	name := r.PathValue("name")

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

	result, err := h.sandboxSvc.GetLogs(r.Context(), workspace, name, opts...)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandboxLogs(result))
}

func (h *LogsHandler) StreamSandboxLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := w.(http.Flusher); !ok {
		apiutils.WriteError(w, http.StatusInternalServerError,
			apiutils.Internal, "streaming is unavailable")
		return
	}

	query := r.URL.Query()

	logTailLines := uint32(200)
	source := query["source"]
	logMinLevel := query.Get("level")

	if raw := query.Get("lines"); raw != "" {
		n, err := strconv.ParseUint(raw, 10, 32)
		if err != nil {
			apiutils.WriteError(w, http.StatusBadRequest,
				apiutils.InvalidArgument, "invalid lines")
			return
		}
		logTailLines = uint32(n)
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	stream, err := h.sandboxSvc.StreamSandboxLogs(
		ctx,
		r.PathValue("workspace"),
		r.PathValue("name"),
		logTailLines,
		source,
		logMinLevel,
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}

	first, err := stream.Recv()
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")

	rc := http.NewResponseController(w)
	defer func() { _ = rc.SetWriteDeadline(time.Time{}) }()

	write := func(frame string) error {
		// Prevent a stalled browser from retaining this handler forever.
		if err := rc.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil &&
			!errors.Is(err, http.ErrNotSupported) {
			return err
		}
		if _, err := io.WriteString(w, frame); err != nil {
			return err
		}
		return rc.Flush()
	}

	send := func(kind string, payload any) error {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		return write(fmt.Sprintf("event: %s\ndata: %s\n\n", kind, data))
	}

	forward := func(event *pb.SandboxStreamEvent) error {
		if line := event.GetLog(); line != nil {
			return send("log", models.FromProtoSandboxLogLine(line))
		}
		if warning := event.GetWarning(); warning != nil {
			return send("warning", struct {
				Message string `json:"message"`
			}{Message: warning.GetMessage()})
		}
		return nil
	}

	if err := write(": connected\n\n"); err != nil {
		return
	}
	if err := forward(first); err != nil {
		return
	}

	type received struct {
		event *pb.SandboxStreamEvent
		err   error
	}
	incoming := make(chan received, 1)

	// handle events from sandbox logs
	go func() {
		for {
			event, err := stream.Recv()
			select {
			case incoming <- received{event: event, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()

	// handle http server sent events
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-heartbeat.C:
			if err := write(": keepalive\n\n"); err != nil {
				return
			}

		case next := <-incoming:
			if next.err != nil {
				if ctx.Err() != nil {
					return
				}
				if errors.Is(next.err, io.EOF) {
					_ = send("end", struct{}{})
				} else {
					// HTTP headers are committed: send an SSE error,
					// never append a normal JSON error response.
					_ = send("stream-error", apiutils.ErrorResponse{
						Code:    apiutils.GatewayUnavailable,
						Message: "Live logs disconnected",
					})
				}
				return
			}
			if err := forward(next.event); err != nil {
				return
			}
		}
	}
}

// ListSandboxProviders lists provider records attached to a sandbox.
func (h *LogsHandler) ListSandboxProviders(w http.ResponseWriter, r *http.Request) {
	workspace, name := r.PathValue("workspace"), r.PathValue("name")
	providers, err := h.sandboxSvc.ListAllProviders(r.Context(), workspace, name)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	var keys map[string][]string
	if h.keys != nil {
		if keys, err = h.keys.ListSandboxProviderCredentialKeys(r.Context(), workspace, name); err != nil {
			apiutils.WriteSDKError(w, err)
			return
		}
	}
	out := make([]models.Provider, 0, len(providers))
	for _, provider := range providers {
		dto := models.FromSDKProvider(provider)
		dto.AddCredentialNames(keys[dto.Metadata.Name])
		out = append(out, dto)
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

// attachDetachRequest carries the optimistic-concurrency version from the
// caller's last read (0 skips the check).
type attachDetachRequest struct {
	ExpectedResourceVersion uint64 `json:"expectedResourceVersion,omitempty"`
}

// AttachSandboxProvider attaches a provider to a sandbox.
func (h *LogsHandler) AttachSandboxProvider(w http.ResponseWriter, r *http.Request) {
	var body attachDetachRequest
	if r.ContentLength > 0 && !apiutils.DecodeBody(w, r, &body) {
		return
	}
	result, err := h.sandboxSvc.AttachProvider(
		r.Context(),
		r.PathValue("workspace"),
		r.PathValue("name"),
		r.PathValue("provider"),
		body.ExpectedResourceVersion,
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := map[string]any{"attached": result.Attached}
	if result.Sandbox != nil {
		out["sandbox"] = models.FromSDKSandbox(result.Sandbox)
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

// DetachSandboxProvider detaches a provider from a sandbox.
func (h *LogsHandler) DetachSandboxProvider(w http.ResponseWriter, r *http.Request) {
	var body attachDetachRequest
	if r.ContentLength > 0 && !apiutils.DecodeBody(w, r, &body) {
		return
	}
	result, err := h.sandboxSvc.DetachProvider(
		r.Context(),
		r.PathValue("workspace"),
		r.PathValue("name"),
		r.PathValue("provider"),
		body.ExpectedResourceVersion,
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := map[string]any{"detached": result.Detached}
	if result.Sandbox != nil {
		out["sandbox"] = models.FromSDKSandbox(result.Sandbox)
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}
