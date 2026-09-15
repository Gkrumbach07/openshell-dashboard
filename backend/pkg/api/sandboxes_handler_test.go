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

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestListSandboxes(t *testing.T) {
	tests := []struct {
		listFn     func(ctx context.Context, workspace string, opts ...openshell.ListOptions) ([]*openshell.Sandbox, error)
		name       string
		wantStatus int
	}{
		{
			name: "success returns sandbox list",
			listFn: func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Sandbox, error) {
				return []*openshell.Sandbox{
					{ID: "id-1", Name: "my-sandbox", Status: openshell.SandboxStatus{Phase: openshell.SandboxReady}},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "empty list returns empty array",
			listFn: func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Sandbox, error) {
				return nil, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "gateway unavailable returns 502",
			listFn: func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "gateway down"}
			},
			wantStatus: http.StatusBadGateway,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.listFn = tc.listFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes", app.ListSandboxes)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestListSandboxesBody(t *testing.T) {
	sdk := &mockSDK{}
	sdk.sandboxes.listFn = func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Sandbox, error) {
		return []*openshell.Sandbox{
			{
				ID: "id-1", Name: "my-sandbox", Workspace: "default",
				CreatedAt: time.Unix(1700000000, 0),
				Spec:      openshell.SandboxSpec{Template: &openshell.SandboxTemplate{Image: "ubuntu:latest"}},
				Status:    openshell.SandboxStatus{Phase: openshell.SandboxReady},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes", app.ListSandboxes)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body []map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("got %d sandboxes, want 1", len(body))
	}
	meta, ok := body[0]["metadata"].(map[string]any)
	if !ok {
		t.Fatal("metadata is not a map")
	}
	if meta["name"] != "my-sandbox" {
		t.Errorf("name = %v, want my-sandbox", meta["name"])
	}
	st, ok := body[0]["status"].(map[string]any)
	if !ok {
		t.Fatal("status is not a map")
	}
	if st["phase"] != "READY" {
		t.Errorf("phase = %v, want READY", st["phase"])
	}
}

func TestCreateSandbox(t *testing.T) {
	tests := []struct {
		createFn   func(ctx context.Context, workspace, name string, spec *openshell.SandboxSpec, labels map[string]string, opts ...openshell.CreateOptions) (*openshell.Sandbox, error)
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"name":"my-sandbox","image":"ubuntu:latest","policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`,
			createFn: func(_ context.Context, _, name string, _ *openshell.SandboxSpec, _ map[string]string, _ ...openshell.CreateOptions) (*openshell.Sandbox, error) {
				return &openshell.Sandbox{ID: "id-1", Name: name, Status: openshell.SandboxStatus{Phase: openshell.SandboxProvisioning}}, nil
			},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing image",
			body:       `{"name":"my-sandbox","policy":{"version":1}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_image",
		},
		{
			name:       "missing policy",
			body:       `{"name":"my-sandbox","image":"ubuntu:latest"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_policy",
		},
		{
			name:       "invalid name - uppercase",
			body:       `{"name":"MyBadName","image":"ubuntu:latest","policy":{"version":1}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_name",
		},
		{
			name:       "invalid name - trailing dash",
			body:       `{"name":"bad-","image":"ubuntu:latest","policy":{"version":1}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_name",
		},
		{
			name:       "malformed JSON body",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_body",
		},
		{
			name: "gateway already exists",
			body: `{"name":"dup","image":"ubuntu:latest","policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`,
			createFn: func(_ context.Context, _, _ string, _ *openshell.SandboxSpec, _ map[string]string, _ ...openshell.CreateOptions) (*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorAlreadyExists, Message: "sandbox already exists"}
			},
			wantStatus: http.StatusConflict,
			wantCode:   "already_exists",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.createFn = tc.createFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes", app.CreateSandbox)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestGetSandbox(t *testing.T) {
	tests := []struct {
		getFn      func(ctx context.Context, workspace, name string) (*openshell.Sandbox, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			getFn: func(_ context.Context, _, name string) (*openshell.Sandbox, error) {
				return &openshell.Sandbox{ID: "id-1", Name: name, Status: openshell.SandboxStatus{Phase: openshell.SandboxReady}}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			getFn: func(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.getFn = tc.getFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes/{name}", app.GetSandbox)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestStopSandbox(t *testing.T) {
	tests := []struct {
		stopFn     func(ctx context.Context, workspace, name string) (*openshell.Sandbox, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			stopFn: func(_ context.Context, _, name string) (*openshell.Sandbox, error) {
				return &openshell.Sandbox{ID: "id-1", Name: name, Status: openshell.SandboxStatus{Phase: openshell.SandboxStopping}}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			stopFn: func(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "already stopped conflicts",
			stopFn: func(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorConflict, Message: "sandbox is not running"}
			},
			wantStatus: http.StatusConflict,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.stopFn = tc.stopFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/stop", app.StopSandbox)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/stop", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestStartSandbox(t *testing.T) {
	tests := []struct {
		startFn    func(ctx context.Context, workspace, name string) (*openshell.Sandbox, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			startFn: func(_ context.Context, _, name string) (*openshell.Sandbox, error) {
				return &openshell.Sandbox{ID: "id-1", Name: name, Status: openshell.SandboxStatus{Phase: openshell.SandboxStarting}}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			startFn: func(_ context.Context, _, _ string) (*openshell.Sandbox, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.startFn = tc.startFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/start", app.StartSandbox)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/start", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteSandbox(t *testing.T) {
	tests := []struct {
		deleteFn   func(ctx context.Context, workspace, name string) error
		name       string
		wantStatus int
	}{
		{
			name: "success",
			deleteFn: func(_ context.Context, _, _ string) error {
				return nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			deleteFn: func(_ context.Context, _, _ string) error {
				return &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "sandbox not found"}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "permission denied",
			deleteFn: func(_ context.Context, _, _ string) error {
				return &openshell.StatusError{Code: openshell.ErrorPermissionDenied, Message: "access denied"}
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.sandboxes.deleteFn = tc.deleteFn
			app := newTestAppWithSDK(sdk)
			r := chi.NewRouter()
			r.Delete("/workspaces/{workspace}/sandboxes/{name}", app.DeleteSandbox)

			req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/sandboxes/my-sandbox", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}
