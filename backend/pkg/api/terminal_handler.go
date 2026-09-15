package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

const (
	defaultTerminalCols uint32 = 80
	defaultTerminalRows uint32 = 24
	defaultShell               = "/bin/bash"
)

type resizeMessage struct {
	Type string `json:"type"`
	Cols uint32 `json:"cols"`
	Rows uint32 `json:"rows"`
}

func parseDimensions(r *http.Request) (cols, rows uint32) {
	cols = defaultTerminalCols
	rows = defaultTerminalRows
	if c, parseErr := strconv.ParseUint(r.URL.Query().Get("cols"), 10, 32); parseErr == nil {
		cols = uint32(c)
	}
	if ro, parseErr := strconv.ParseUint(r.URL.Query().Get("rows"), 10, 32); parseErr == nil {
		rows = uint32(ro)
	}
	return cols, rows
}

func relaySessionToWS(ws *websocket.Conn, session openshell.InteractiveSession, cancel context.CancelFunc) {
	defer cancel()
	buf := make([]byte, 32*1024)
	for {
		n, err := session.Read(buf)
		if n > 0 {
			_ = ws.WriteMessage(websocket.BinaryMessage, buf[:n])
		}
		if err != nil {
			code := 0
			if exitCode, exitErr := session.ExitCode(); exitErr == nil {
				code = exitCode
			}
			msg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, strconv.Itoa(code))
			_ = ws.WriteMessage(websocket.CloseMessage, msg)
			return
		}
	}
}

func (app *App) Terminal(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")
	cols, rows := parseDimensions(r)

	upgrader := websocket.Upgrader{
		CheckOrigin: checkWebSocketOrigin,
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer ws.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	slog.Info("opening interactive session", "workspace", workspace, "name", name, "cols", cols, "rows", rows)
	session, err := app.sdk.Exec().Interactive(ctx, workspace, name, []string{defaultShell}, cols, rows)
	if err != nil {
		slog.Error("interactive session open failed", "error", err)
		_ = ws.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "failed to open exec stream"))
		return
	}
	defer session.Close()
	slog.Info("interactive session opened, entering relay loop")

	go relaySessionToWS(ws, session, cancel)

	for {
		msgType, data, readErr := ws.ReadMessage()
		if readErr != nil {
			cancel()
			return
		}
		if msgType == websocket.TextMessage {
			var resize resizeMessage
			if json.Unmarshal(data, &resize) == nil && resize.Type == "resize" {
				_ = session.Resize(resize.Cols, resize.Rows)
				continue
			}
		}
		if _, writeErr := session.Write(data); writeErr != nil && writeErr != io.EOF {
			cancel()
			return
		}
	}
}

// checkWebSocketOrigin enforces same-origin on browser WebSocket handshakes,
// as defense-in-depth against cross-site WebSocket hijacking. The BFF is
// same-origin-only by design (ADR 0002): browsers reach it via its own origin
// or through a fronting proxy on that origin — there is no cross-origin
// consumer to allow for.
func checkWebSocketOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Browsers always send Origin on a WebSocket handshake; a missing one
		// is a non-browser client that carries no victim's ambient credentials.
		return true
	}
	return origin == "http://"+r.Host || origin == "https://"+r.Host
}
