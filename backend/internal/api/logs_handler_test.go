package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"github.com/NVIDIA/OpenShell/sdk/go/openshell/v1/types"

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
				getSandboxFn:     tc.getSandboxFn,
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

func TestListSandboxProviders(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.listProvidersFn = func(_ context.Context, _, sandboxName string) ([]*openshell.Provider, error) {
		return []*openshell.Provider{
			{
				Name: "claude-prov",
				Type: "claude",
				Spec: openshell.ProviderSpec{
					CredentialHandles: map[string]types.CredentialHandle{
						"api_key": {Driver: "vault", Handle: "vault://must-not-leak"},
					},
				},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/providers", app.ListSandboxProviders)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "must-not-leak") {
		t.Errorf("leaked credential handle: %s", body)
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d providers, want 1", len(got))
	}
	names, _ := got[0]["credentialNames"].([]any)
	if len(names) != 1 || names[0] != "api_key" {
		t.Errorf("credentialNames = %v, want [api_key]", got[0]["credentialNames"])
	}
}

func TestAttachDetachSandboxProvider(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.attachFn = func(_ context.Context, workspace, sandboxName, providerName string, expectedRV uint64) (*openshell.AttachProviderResult, error) {
		if workspace != "default" || sandboxName != "my-sandbox" || providerName != "claude-prov" {
			t.Errorf("attach args = %s/%s/%s", workspace, sandboxName, providerName)
		}
		if expectedRV != 42 {
			t.Errorf("expectedResourceVersion = %d, want 42", expectedRV)
		}
		return &openshell.AttachProviderResult{Attached: true, Sandbox: &openshell.Sandbox{Name: sandboxName}}, nil
	}
	sdk.sandboxes.detachFn = func(_ context.Context, _, sandboxName, _ string, _ uint64) (*openshell.DetachProviderResult, error) {
		return &openshell.DetachProviderResult{Detached: true, Sandbox: &openshell.Sandbox{Name: sandboxName}}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes/{name}/providers/{provider}", app.AttachSandboxProvider)
	r.Delete("/workspaces/{workspace}/sandboxes/{name}/providers/{provider}", app.DetachSandboxProvider)

	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/providers/claude-prov", strings.NewReader(`{"expectedResourceVersion":42}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("attach status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var attach map[string]any
	if err := json.NewDecoder(w.Body).Decode(&attach); err != nil {
		t.Fatalf("decode attach: %v", err)
	}
	if attach["attached"] != true {
		t.Errorf("attached = %v", attach["attached"])
	}

	req = httptest.NewRequest(http.MethodDelete, "/workspaces/default/sandboxes/my-sandbox/providers/claude-prov", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("detach status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}
