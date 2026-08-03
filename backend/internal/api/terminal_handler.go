package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

type resizeMessage struct {
	Type string `json:"type"`
	Cols uint32 `json:"cols"`
	Rows uint32 `json:"rows"`
}

func parseDimensions(r *http.Request) (cols, rows uint32) {
	cols = 80
	rows = 24
	if c, parseErr := strconv.ParseUint(r.URL.Query().Get("cols"), 10, 32); parseErr == nil {
		cols = uint32(c)
	}
	if ro, parseErr := strconv.ParseUint(r.URL.Query().Get("rows"), 10, 32); parseErr == nil {
		rows = uint32(ro)
	}
	return cols, rows
}

func relayGRPCToWS(ws *websocket.Conn, stream openshellv1.OpenShell_ExecSandboxInteractiveClient, cancel context.CancelFunc) {
	defer cancel()
	for {
		event, recvErr := stream.Recv()
		if recvErr != nil {
			return
		}
		switch p := event.Payload.(type) {
		case *openshellv1.ExecSandboxEvent_Stdout:
			_ = ws.WriteMessage(websocket.BinaryMessage, p.Stdout.Data)
		case *openshellv1.ExecSandboxEvent_Stderr:
			_ = ws.WriteMessage(websocket.BinaryMessage, p.Stderr.Data)
		case *openshellv1.ExecSandboxEvent_Exit:
			msg := websocket.FormatCloseMessage(websocket.CloseNormalClosure,
				strconv.Itoa(int(p.Exit.ExitCode)))
			_ = ws.WriteMessage(websocket.CloseMessage, msg)
			return
		}
	}
}

func (app *App) Terminal(w http.ResponseWriter, r *http.Request) {
	workspace := chi.URLParam(r, "workspace")
	name := chi.URLParam(r, "name")

	sandbox, err := app.gateway.GetSandbox(r.Context(), workspace, name)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	sandboxID := sandbox.GetMetadata().GetId()

	cols, rows := parseDimensions(r)

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer ws.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	slog.Info("opening exec stream", "sandbox_id", sandboxID, "cols", cols, "rows", rows)
	stream, err := app.gateway.ExecSandboxInteractive(ctx)
	if err != nil {
		slog.Error("exec stream open failed", "error", err)
		_ = ws.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "failed to open exec stream"))
		return
	}
	slog.Info("exec stream opened, sending start")

	if err := stream.Send(&openshellv1.ExecSandboxInput{
		Payload: &openshellv1.ExecSandboxInput_Start{
			Start: &openshellv1.ExecSandboxRequest{
				SandboxId: sandboxID,
				Command:   []string{"/bin/bash"},
				Tty:       true,
				Cols:      cols,
				Rows:      rows,
			},
		},
	}); err != nil {
		slog.Error("exec start failed", "error", err)
		_ = ws.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "failed to start exec"))
		return
	}
	slog.Info("exec start sent, entering relay loop")

	go relayGRPCToWS(ws, stream, cancel)

	// WS -> gRPC
	for {
		msgType, data, readErr := ws.ReadMessage()
		if readErr != nil {
			cancel()
			return
		}
		if msgType == websocket.TextMessage {
			var resize resizeMessage
			if json.Unmarshal(data, &resize) == nil && resize.Type == "resize" {
				_ = stream.Send(&openshellv1.ExecSandboxInput{
					Payload: &openshellv1.ExecSandboxInput_Resize{
						Resize: &openshellv1.ExecSandboxWindowResize{
							Cols: resize.Cols,
							Rows: resize.Rows,
						},
					},
				})
				continue
			}
		}
		_ = stream.Send(&openshellv1.ExecSandboxInput{
			Payload: &openshellv1.ExecSandboxInput_Stdin{
				Stdin: data,
			},
		})
	}
}
