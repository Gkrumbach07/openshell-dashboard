package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// fakeWatchStream implements openshellv1.OpenShell_WatchSandboxClient,
// serving a fixed list of events then blocking until the context ends.
type fakeWatchStream struct {
	grpc.ClientStream
	ctx    context.Context
	events []*openshellv1.SandboxStreamEvent
	index  int
}

func (s *fakeWatchStream) Recv() (*openshellv1.SandboxStreamEvent, error) {
	if s.index < len(s.events) {
		evt := s.events[s.index]
		s.index++
		return evt, nil
	}
	<-s.ctx.Done()
	return nil, s.ctx.Err()
}

func (s *fakeWatchStream) Header() (metadata.MD, error) { return nil, nil }
func (s *fakeWatchStream) Trailer() metadata.MD         { return nil }
func (s *fakeWatchStream) CloseSend() error             { return nil }
func (s *fakeWatchStream) Context() context.Context     { return s.ctx }

func watchTestServer(t *testing.T, gw *mockGateway) *httptest.Server {
	t.Helper()
	app := newTestApp(gw)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/watch", app.WatchSandbox)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return server
}

func TestWatchSandboxRelaysEvents(t *testing.T) {
	var gotReq *openshellv1.WatchSandboxRequest
	gw := &mockGateway{
		getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
			return &openshellv1.Sandbox{
				Metadata: &datamodelv1.ObjectMeta{Id: "sb-id-1", Name: "my-sandbox", Workspace: "default"},
			}, nil
		},
		watchSandboxFn: func(ctx context.Context, req *openshellv1.WatchSandboxRequest) (openshellv1.OpenShell_WatchSandboxClient, error) {
			gotReq = req
			return &fakeWatchStream{
				ctx: ctx,
				events: []*openshellv1.SandboxStreamEvent{
					{Payload: &openshellv1.SandboxStreamEvent_Sandbox{
						Sandbox: &openshellv1.Sandbox{
							Metadata: &datamodelv1.ObjectMeta{Id: "sb-id-1", Name: "my-sandbox", Workspace: "default"},
							Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_READY},
						},
					}},
					{Payload: &openshellv1.SandboxStreamEvent_Warning{
						Warning: &openshellv1.SandboxStreamWarning{Message: "lagged"},
					}},
				},
			}, nil
		},
	}
	server := watchTestServer(t, gw)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/workspaces/default/sandboxes/my-sandbox/watch"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer ws.Close()

	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))

	var first models.WatchEvent
	if _, data, readErr := ws.ReadMessage(); readErr != nil {
		t.Fatalf("read first frame: %v", readErr)
	} else if unmarshalErr := json.Unmarshal(data, &first); unmarshalErr != nil {
		t.Fatalf("unmarshal first frame: %v", unmarshalErr)
	}
	if first.Type != "sandbox" || first.Sandbox == nil || first.Sandbox.Status.Phase != "READY" {
		t.Errorf("first frame = %+v, want sandbox snapshot with READY phase", first)
	}

	var second models.WatchEvent
	if _, data, readErr := ws.ReadMessage(); readErr != nil {
		t.Fatalf("read second frame: %v", readErr)
	} else if unmarshalErr := json.Unmarshal(data, &second); unmarshalErr != nil {
		t.Fatalf("unmarshal second frame: %v", unmarshalErr)
	}
	if second.Type != "warning" || second.Warning != "lagged" {
		t.Errorf("second frame = %+v, want warning 'lagged'", second)
	}

	if gotReq.GetId() != "sb-id-1" {
		t.Errorf("watch request id = %q, want sb-id-1 (resolved from name)", gotReq.GetId())
	}
	if !gotReq.GetFollowStatus() {
		t.Error("watch request should always follow status")
	}
	if gotReq.GetFollowLogs() {
		t.Error("watch request should not follow logs unless requested")
	}
}

func TestWatchSandboxLogParams(t *testing.T) {
	var gotReq *openshellv1.WatchSandboxRequest
	gw := &mockGateway{
		getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
			return &openshellv1.Sandbox{
				Metadata: &datamodelv1.ObjectMeta{Id: "sb-id-1", Name: "my-sandbox", Workspace: "default"},
			}, nil
		},
		watchSandboxFn: func(ctx context.Context, req *openshellv1.WatchSandboxRequest) (openshellv1.OpenShell_WatchSandboxClient, error) {
			gotReq = req
			return &fakeWatchStream{ctx: ctx}, nil
		},
	}
	server := watchTestServer(t, gw)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") +
		"/workspaces/default/sandboxes/my-sandbox/watch?logs=true&lines=50&level=WARN&source=sandbox"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	ws.Close()

	deadline := time.Now().Add(2 * time.Second)
	for gotReq == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if gotReq == nil {
		t.Fatal("watch stream was never opened")
	}
	if !gotReq.GetFollowLogs() || gotReq.GetLogTailLines() != 50 ||
		gotReq.GetLogMinLevel() != "WARN" || len(gotReq.GetLogSources()) != 1 || gotReq.GetLogSources()[0] != "sandbox" {
		t.Errorf("watch request = %+v, want followLogs with lines=50 level=WARN source=sandbox", gotReq)
	}
}

func TestWatchSandboxGetSandboxError(t *testing.T) {
	gw := &mockGateway{
		getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
			return nil, status.Error(codes.NotFound, "no such sandbox")
		},
	}
	server := watchTestServer(t, gw)

	resp, err := http.Get(server.URL + "/workspaces/default/sandboxes/missing/watch")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}
