package api

// End-to-end test of the live-updates path: a real gRPC server implementing
// the OpenShell service, a real gateway.Client dialing it over TCP, the real
// chi router (auth disabled, FEATURE_LIVE_UPDATES on), and a real WebSocket
// client. Verifies the whole chain — gRPC stream → gateway wrapper → WS
// relay → JSON frames — including log following.

import (
	"context"
	"encoding/json"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/grpc"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

type e2eOpenShellServer struct {
	openshellv1.UnimplementedOpenShellServer
	// watchRequests records the WatchSandboxRequest each stream opened with.
	watchRequests chan *openshellv1.WatchSandboxRequest
	// events is drained into every open watch stream.
	events chan *openshellv1.SandboxStreamEvent
}

func e2eSandbox(phase openshellv1.SandboxPhase) *openshellv1.Sandbox {
	return &openshellv1.Sandbox{
		Metadata: &datamodelv1.ObjectMeta{Id: "e2e-id-1", Name: "e2e-sandbox", Workspace: "default"},
		Status:   &openshellv1.SandboxStatus{Phase: phase},
	}
}

func (s *e2eOpenShellServer) GetSandbox(_ context.Context, _ *openshellv1.GetSandboxRequest) (*openshellv1.SandboxResponse, error) {
	return &openshellv1.SandboxResponse{Sandbox: e2eSandbox(openshellv1.SandboxPhase_SANDBOX_PHASE_READY)}, nil
}

func (s *e2eOpenShellServer) WatchSandbox(req *openshellv1.WatchSandboxRequest, stream grpc.ServerStreamingServer[openshellv1.SandboxStreamEvent]) error {
	s.watchRequests <- req
	// Initial snapshot, mirroring the real gateway's producer.
	if err := stream.Send(&openshellv1.SandboxStreamEvent{
		Payload: &openshellv1.SandboxStreamEvent_Sandbox{
			Sandbox: e2eSandbox(openshellv1.SandboxPhase_SANDBOX_PHASE_READY),
		},
	}); err != nil {
		return err
	}
	for {
		select {
		case evt := <-s.events:
			if err := stream.Send(evt); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

// startE2EStack boots the fake gRPC gateway, a real gateway.Client, and the
// real router, returning the WS URL base and the fake server for triggering
// events.
func startE2EStack(t *testing.T) (string, *e2eOpenShellServer) {
	t.Helper()

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	fake := &e2eOpenShellServer{
		watchRequests: make(chan *openshellv1.WatchSandboxRequest, 4),
		events:        make(chan *openshellv1.SandboxStreamEvent, 16),
	}
	grpcServer := grpc.NewServer()
	openshellv1.RegisterOpenShellServer(grpcServer, fake)
	go func() { _ = grpcServer.Serve(lis) }()
	t.Cleanup(grpcServer.Stop)

	gatewayClient, err := gateway.New(lis.Addr().String(), "")
	if err != nil {
		t.Fatalf("gateway client: %v", err)
	}
	t.Cleanup(func() { _ = gatewayClient.Close() })

	app := NewApp(
		gatewayClient,
		auth.New(auth.Config{Disabled: true}),
		"",
		AuthConfigResponse{AuthDisabled: true, Features: FeatureFlags{LiveUpdates: true}},
	)
	server := httptest.NewServer(app.Routes())
	t.Cleanup(server.Close)

	return "ws" + strings.TrimPrefix(server.URL, "http"), fake
}

func readWatchEvent(t *testing.T, ws *websocket.Conn) models.WatchEvent {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var evt models.WatchEvent
	if err := json.Unmarshal(data, &evt); err != nil {
		t.Fatalf("unmarshal frame %q: %v", data, err)
	}
	return evt
}

// requireWatchRequest asserts the relay resolved name → id and opened the
// stream with the right follow options.
func requireWatchRequest(t *testing.T, fake *e2eOpenShellServer) {
	t.Helper()
	select {
	case req := <-fake.watchRequests:
		if req.GetId() != "e2e-id-1" || !req.GetFollowStatus() || !req.GetFollowLogs() ||
			req.GetLogTailLines() != 50 || req.GetLogMinLevel() != "INFO" {
			t.Errorf("watch request = %+v, want id=e2e-id-1 followStatus followLogs lines=50 level=INFO", req)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("gateway never received a WatchSandbox request")
	}
}

func TestE2EWatchRelaysSnapshotsAndLogs(t *testing.T) {
	wsBase, fake := startE2EStack(t)

	ws, _, err := websocket.DefaultDialer.Dial(
		wsBase+"/api/v1/workspaces/default/sandboxes/e2e-sandbox/watch?logs=true&lines=50&level=INFO",
		nil,
	)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	defer ws.Close()

	requireWatchRequest(t, fake)

	// Initial snapshot arrives through the whole chain.
	first := readWatchEvent(t, ws)
	if first.Type != "sandbox" || first.Sandbox == nil || first.Sandbox.Metadata.ID != "e2e-id-1" {
		t.Fatalf("first frame = %+v, want initial sandbox snapshot", first)
	}

	// A pushed status change (what the gateway emits on a draft mutation).
	fake.events <- &openshellv1.SandboxStreamEvent{
		Payload: &openshellv1.SandboxStreamEvent_Sandbox{
			Sandbox: e2eSandbox(openshellv1.SandboxPhase_SANDBOX_PHASE_READY),
		},
	}
	second := readWatchEvent(t, ws)
	if second.Type != "sandbox" {
		t.Fatalf("second frame type = %q, want sandbox", second.Type)
	}

	// A pushed log line (Phase 3 follow_logs path).
	fake.events <- &openshellv1.SandboxStreamEvent{
		Payload: &openshellv1.SandboxStreamEvent_Log{
			Log: &openshellv1.SandboxLogLine{
				SandboxId:   "e2e-id-1",
				TimestampMs: 42,
				Level:       "INFO",
				Message:     "network decision",
				Source:      "sandbox",
				Fields:      map[string]string{"dst_host": "google.com", "action": "deny"},
			},
		},
	}
	third := readWatchEvent(t, ws)
	if third.Type != "log" || third.Log == nil || third.Log.Message != "network decision" ||
		third.Log.Fields["dst_host"] != "google.com" {
		t.Fatalf("third frame = %+v, want relayed log line", third)
	}
}

func TestE2EWatchRouteAbsentWhenFlagOff(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	grpcServer := grpc.NewServer()
	openshellv1.RegisterOpenShellServer(grpcServer, &e2eOpenShellServer{
		watchRequests: make(chan *openshellv1.WatchSandboxRequest, 1),
		events:        make(chan *openshellv1.SandboxStreamEvent, 1),
	})
	go func() { _ = grpcServer.Serve(lis) }()
	t.Cleanup(grpcServer.Stop)

	gatewayClient, err := gateway.New(lis.Addr().String(), "")
	if err != nil {
		t.Fatalf("gateway client: %v", err)
	}
	t.Cleanup(func() { _ = gatewayClient.Close() })

	app := NewApp(
		gatewayClient,
		auth.New(auth.Config{Disabled: true}),
		"",
		AuthConfigResponse{AuthDisabled: true, Features: FeatureFlags{LiveUpdates: false}},
	)
	server := httptest.NewServer(app.Routes())
	t.Cleanup(server.Close)

	wsBase := "ws" + strings.TrimPrefix(server.URL, "http")
	_, resp, err := websocket.DefaultDialer.Dial(
		wsBase+"/api/v1/workspaces/default/sandboxes/e2e-sandbox/watch",
		nil,
	)
	if err == nil {
		t.Fatal("dial succeeded, want the watch route to be absent when the flag is off")
	}
	if resp == nil || resp.StatusCode != 404 {
		t.Fatalf("dial response = %+v, want 404", resp)
	}
}
