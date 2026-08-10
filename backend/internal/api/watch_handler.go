package api

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

const (
	// watchWriteWait bounds a single WebSocket write.
	watchWriteWait = 10 * time.Second
	// watchPongWait is how long the client has to answer a ping. Unlike the
	// terminal relay, a watch stream can be silent for minutes, so keepalive
	// pings are the only way to detect a half-dead proxy connection.
	watchPongWait = 60 * time.Second
	// watchPingPeriod must be shorter than watchPongWait.
	watchPingPeriod = 50 * time.Second
	// watchEventBuffer absorbs bursts from the gateway watch bus while a
	// slow client drains earlier frames.
	watchEventBuffer = 32
)

// WatchSandbox relays the gateway's server-streaming WatchSandbox RPC over a
// WebSocket as JSON WatchEvent frames. Status snapshots are always followed;
// log following is opt-in via query params.
//
// Query params: logs=true enables log following, with the same filters as
// GET .../logs — lines (tail replay, default 200), sinceMs, source
// (repeatable: gateway|sandbox), level (min level, e.g. INFO).
//
// WatchSandbox (gRPC) takes sandbox_id, not name — the BFF resolves
// name → metadata.id via GetSandbox.
func (app *App) WatchSandbox(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()
	if sandboxID == "" {
		writeError(w, http.StatusNotFound, "not_found", "sandbox has no id")
		return
	}

	query := r.URL.Query()
	req := &openshellv1.WatchSandboxRequest{
		Id:           sandboxID,
		FollowStatus: true,
	}
	if query.Get("logs") == "true" {
		req.FollowLogs = true
		req.LogTailLines = 200
		if raw := query.Get("lines"); raw != "" {
			if parsed, parseErr := strconv.ParseUint(raw, 10, 32); parseErr == nil {
				req.LogTailLines = uint32(parsed)
			}
		}
		if raw := query.Get("sinceMs"); raw != "" {
			if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
				req.LogSinceMs = parsed
			}
		}
		req.LogSources = query["source"]
		req.LogMinLevel = query.Get("level")
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: checkWebSocketOrigin,
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("watch websocket upgrade failed", "error", err)
		return
	}
	defer ws.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	stream, err := app.gateway.WatchSandbox(ctx, req)
	if err != nil {
		slog.Error("watch stream open failed", "sandbox_id", sandboxID, "error", err)
		_ = ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "failed to open watch stream"),
			time.Now().Add(watchWriteWait))
		return
	}

	// Reader pump: the client sends no application messages, but reading is
	// required to process pong control frames and detect close.
	go func() {
		ws.SetReadLimit(512)
		_ = ws.SetReadDeadline(time.Now().Add(watchPongWait))
		ws.SetPongHandler(func(string) error {
			return ws.SetReadDeadline(time.Now().Add(watchPongWait))
		})
		for {
			if _, _, readErr := ws.ReadMessage(); readErr != nil {
				cancel()
				return
			}
		}
	}()

	// gRPC → channel pump. Closing the channel signals stream end to the
	// writer loop below.
	events := make(chan models.WatchEvent, watchEventBuffer)
	go func() {
		defer close(events)
		for {
			evt, recvErr := stream.Recv()
			if recvErr != nil {
				return
			}
			frame, ok := models.FromSandboxStreamEvent(evt)
			if !ok {
				continue
			}
			select {
			case events <- frame:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Writer loop: gorilla/websocket allows one concurrent writer, so this
	// goroutine owns all data and ping writes.
	ticker := time.NewTicker(watchPingPeriod)
	defer ticker.Stop()
	for {
		select {
		case frame, ok := <-events:
			if !ok {
				_ = ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "stream ended"),
					time.Now().Add(watchWriteWait))
				return
			}
			_ = ws.SetWriteDeadline(time.Now().Add(watchWriteWait))
			if writeErr := ws.WriteJSON(frame); writeErr != nil {
				return
			}
		case <-ticker.C:
			_ = ws.SetWriteDeadline(time.Now().Add(watchWriteWait))
			if pingErr := ws.WriteMessage(websocket.PingMessage, nil); pingErr != nil {
				return
			}
		}
	}
}
