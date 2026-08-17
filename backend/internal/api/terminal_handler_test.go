package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestCheckWebSocketOrigin(t *testing.T) {
	tests := []struct { //nolint:govet // fieldalignment: test readability
		name   string
		origin string
		host   string
		want   bool
	}{
		{
			name:   "empty origin allowed (non-browser client)",
			origin: "",
			host:   "dashboard.example.com",
			want:   true,
		},
		{
			name:   "same-origin http match",
			origin: "http://localhost:8080",
			host:   "localhost:8080",
			want:   true,
		},
		{
			name:   "same-origin https match",
			origin: "https://dashboard.example.com",
			host:   "dashboard.example.com",
			want:   true,
		},
		{
			name:   "cross-origin rejected",
			origin: "https://evil.com",
			host:   "dashboard.example.com",
			want:   false,
		},
		{
			name:   "subdomain rejected",
			origin: "https://evil.dashboard.example.com",
			host:   "dashboard.example.com",
			want:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, "/terminal", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.host != "" {
				req.Host = tc.host
			}
			got := checkWebSocketOrigin(req)
			if got != tc.want {
				t.Errorf("checkWebSocketOrigin() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestTerminalRelay(t *testing.T) {
	session := &mockInteractiveSession{reads: make(chan []byte, 1)}
	session.reads <- []byte("hi")

	sdk := &mockSDK{}
	var gotCols, gotRows uint32
	sdk.exec.interactiveFn = func(_ context.Context, workspace, name string, command []string, cols, rows uint32, _ ...openshell.ExecOptions) (openshell.InteractiveSession, error) {
		if workspace != "default" || name != "sb" {
			t.Errorf("sandbox = %s/%s", workspace, name)
		}
		if len(command) != 1 || command[0] != defaultShell {
			t.Errorf("command = %v", command)
		}
		gotCols, gotRows = cols, rows
		return session, nil
	}

	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/terminal", app.Terminal)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/workspaces/default/sandboxes/sb/terminal?cols=100&rows=30"
	ws, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = ws.Close() })

	_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	msgType, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if msgType != websocket.BinaryMessage || string(data) != "hi" {
		t.Fatalf("got type=%d data=%q, want binary hi", msgType, data)
	}

	if err := ws.WriteMessage(websocket.BinaryMessage, []byte("ls\n")); err != nil {
		t.Fatal(err)
	}
	if err := ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"resize","cols":120,"rows":40}`)); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		session.mu.Lock()
		ok := string(session.written) == "ls\n" && len(session.resizes) == 1
		session.mu.Unlock()
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	session.mu.Lock()
	written := string(session.written)
	resizes := append([][2]uint32(nil), session.resizes...)
	session.mu.Unlock()
	if written != "ls\n" {
		t.Errorf("written = %q, want ls\\n", written)
	}
	if len(resizes) != 1 || resizes[0] != [2]uint32{120, 40} {
		t.Errorf("resizes = %v, want [120 40]", resizes)
	}
	if gotCols != 100 || gotRows != 30 {
		t.Errorf("dims = %d x %d, want 100x30", gotCols, gotRows)
	}
}
