package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func TestGetSandboxLogs(t *testing.T) {
	tests := []struct {
		getSandboxFn func(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error)
		getLogsFn    func(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error)
		name         string
		url          string
		wantStatus   int
	}{
		{
			name: "success with all filters",
			url:  "/workspaces/default/sandboxes/my-sandbox/logs?lines=50&sinceMs=1000&source=gateway&source=sandbox&level=INFO",
			getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return &openshellv1.Sandbox{
					Metadata: &datamodelv1.ObjectMeta{Id: "sandbox-uuid", Name: "my-sandbox"},
				}, nil
			},
			getLogsFn: func(_ context.Context, _, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error) {
				if sandboxID != "sandbox-uuid" {
					t.Errorf("sandboxID = %q, want sandbox-uuid", sandboxID)
				}
				if lines != 50 {
					t.Errorf("lines = %d, want 50", lines)
				}
				if sinceMs != 1000 {
					t.Errorf("sinceMs = %d, want 1000", sinceMs)
				}
				if len(sources) != 2 {
					t.Errorf("sources = %v, want [gateway sandbox]", sources)
				}
				if minLevel != "INFO" {
					t.Errorf("minLevel = %q, want INFO", minLevel)
				}
				return &openshellv1.GetSandboxLogsResponse{
					Logs: []*openshellv1.SandboxLogLine{
						{Message: "hello", Level: "INFO", TimestampMs: 1234},
					},
					BufferTotal: 100,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "success with no filters uses default lines",
			url:  "/workspaces/default/sandboxes/my-sandbox/logs",
			getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return &openshellv1.Sandbox{
					Metadata: &datamodelv1.ObjectMeta{Id: "sandbox-uuid", Name: "my-sandbox"},
				}, nil
			},
			getLogsFn: func(_ context.Context, _, _ string, lines uint32, _ int64, _ []string, _ string) (*openshellv1.GetSandboxLogsResponse, error) {
				if lines != 200 {
					t.Errorf("default lines = %d, want 200", lines)
				}
				return &openshellv1.GetSandboxLogsResponse{}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "invalid lines param uses default",
			url:  "/workspaces/default/sandboxes/my-sandbox/logs?lines=notanumber",
			getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return &openshellv1.Sandbox{
					Metadata: &datamodelv1.ObjectMeta{Id: "sandbox-uuid", Name: "my-sandbox"},
				}, nil
			},
			getLogsFn: func(_ context.Context, _, _ string, lines uint32, _ int64, _ []string, _ string) (*openshellv1.GetSandboxLogsResponse, error) {
				if lines != 200 {
					t.Errorf("default lines = %d, want 200 (invalid param ignored)", lines)
				}
				return &openshellv1.GetSandboxLogsResponse{}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "sandbox not found",
			url:  "/workspaces/default/sandboxes/missing/logs",
			getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return nil, status.Error(codes.NotFound, "sandbox not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{
				getSandboxFn:    tc.getSandboxFn,
				getSandboxLogsFn: tc.getLogsFn,
			})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes/{name}/logs", app.GetSandboxLogs)

			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestGetSandboxLogsBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		getSandboxFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
			return &openshellv1.Sandbox{
				Metadata: &datamodelv1.ObjectMeta{Id: "uuid-1", Name: "my-sandbox"},
			}, nil
		},
		getSandboxLogsFn: func(_ context.Context, _, _ string, _ uint32, _ int64, _ []string, _ string) (*openshellv1.GetSandboxLogsResponse, error) {
			return &openshellv1.GetSandboxLogsResponse{
				Logs: []*openshellv1.SandboxLogLine{
					{
						Message:     "network decision",
						Level:       "WARN",
						Source:      "gateway",
						TimestampMs: 5000,
						Fields:      map[string]string{"dst_host": "api.example.com", "action": "deny"},
					},
				},
				BufferTotal: 42,
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/logs", app.GetSandboxLogs)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/logs", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if v, ok := body["bufferTotal"].(float64); !ok || v != 42 {
		t.Errorf("bufferTotal = %v, want 42", body["bufferTotal"])
	}
	logs, ok := body["logs"].([]any)
	if !ok || len(logs) != 1 {
		t.Fatalf("logs length = %d, want 1", len(logs))
	}
	line, ok := logs[0].(map[string]any)
	if !ok {
		t.Fatal("log entry is not a map")
	}
	if line["message"] != "network decision" {
		t.Errorf("message = %v", line["message"])
	}
	fields, ok := line["fields"].(map[string]any)
	if !ok {
		t.Fatal("fields is not a map")
	}
	if fields["dst_host"] != "api.example.com" {
		t.Errorf("dst_host = %v", fields["dst_host"])
	}
}
