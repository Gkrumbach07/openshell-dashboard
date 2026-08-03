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

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func TestListSandboxes(t *testing.T) {
	tests := []struct {
		name       string
		mockFn     func(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error)
		wantStatus int
	}{
		{
			name: "success returns sandbox list",
			mockFn: func(_ context.Context, _ string, _, _ uint32, _ string) ([]*openshellv1.Sandbox, error) {
				return []*openshellv1.Sandbox{
					{
						Metadata: &datamodelv1.ObjectMeta{Id: "id-1", Name: "my-sandbox"},
						Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_READY},
					},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "empty list returns empty array",
			mockFn: func(_ context.Context, _ string, _, _ uint32, _ string) ([]*openshellv1.Sandbox, error) {
				return nil, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "gateway unavailable returns 502",
			mockFn: func(_ context.Context, _ string, _, _ uint32, _ string) ([]*openshellv1.Sandbox, error) {
				return nil, status.Error(codes.Unavailable, "gateway down")
			},
			wantStatus: http.StatusBadGateway,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{listSandboxesFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes", app.ListSandboxes)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestListSandboxesBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		listSandboxesFn: func(_ context.Context, _ string, _, _ uint32, _ string) ([]*openshellv1.Sandbox, error) {
			return []*openshellv1.Sandbox{
				{
					Metadata: &datamodelv1.ObjectMeta{Id: "id-1", Name: "my-sandbox", Workspace: "default"},
					Spec:     &openshellv1.SandboxSpec{Template: &openshellv1.SandboxTemplate{Image: "ubuntu:latest"}},
					Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_READY},
				},
			}, nil
		},
	})
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
	meta := body[0]["metadata"].(map[string]any)
	if meta["name"] != "my-sandbox" {
		t.Errorf("name = %v, want my-sandbox", meta["name"])
	}
	st := body[0]["status"].(map[string]any)
	if st["phase"] != "READY" {
		t.Errorf("phase = %v, want READY", st["phase"])
	}
}

func TestCreateSandbox(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		mockFn     func(ctx context.Context, workspace, name string, spec *openshellv1.SandboxSpec, labels, annotations map[string]string) (*openshellv1.Sandbox, error)
		wantStatus int
		wantCode   string
	}{
		{
			name: "success",
			body: `{"name":"my-sandbox","image":"ubuntu:latest","policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`,
			mockFn: func(_ context.Context, _, _ string, _ *openshellv1.SandboxSpec, _, _ map[string]string) (*openshellv1.Sandbox, error) {
				return &openshellv1.Sandbox{
					Metadata: &datamodelv1.ObjectMeta{Id: "id-1", Name: "my-sandbox"},
					Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_PROVISIONING},
				}, nil
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
			name:       "unknown field in body",
			body:       `{"name":"ok","image":"img","policy":{"version":1},"bogus":true}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_body",
		},
		{
			name:       "invalid policy schema",
			body:       `{"name":"ok","image":"img","policy":{"notAField":true}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_policy",
		},
		{
			name: "gateway already exists",
			body: `{"name":"dup","image":"ubuntu:latest","policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`,
			mockFn: func(_ context.Context, _, _ string, _ *openshellv1.SandboxSpec, _, _ map[string]string) (*openshellv1.Sandbox, error) {
				return nil, status.Error(codes.AlreadyExists, "sandbox already exists")
			},
			wantStatus: http.StatusConflict,
			wantCode:   "already_exists",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockGateway{createSandboxFn: tc.mockFn}
			app := newTestApp(mock)
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
				json.NewDecoder(w.Body).Decode(&errResp)
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestGetSandbox(t *testing.T) {
	tests := []struct {
		name       string
		mockFn     func(ctx context.Context, workspace, name string) (*openshellv1.Sandbox, error)
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return &openshellv1.Sandbox{
					Metadata: &datamodelv1.ObjectMeta{Id: "id-1", Name: "my-sandbox"},
					Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_READY},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _ string) (*openshellv1.Sandbox, error) {
				return nil, status.Error(codes.NotFound, "sandbox not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getSandboxFn: tc.mockFn})
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

func TestDeleteSandbox(t *testing.T) {
	tests := []struct {
		name       string
		mockFn     func(ctx context.Context, workspace, name string) (bool, error)
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _ string) (bool, error) {
				return true, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _ string) (bool, error) {
				return false, status.Error(codes.NotFound, "sandbox not found")
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "permission denied",
			mockFn: func(_ context.Context, _, _ string) (bool, error) {
				return false, status.Error(codes.PermissionDenied, "access denied")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{deleteSandboxFn: tc.mockFn})
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

func TestCreateSandboxWithGPUAndResources(t *testing.T) {
	var capturedSpec *openshellv1.SandboxSpec
	mock := &mockGateway{
		createSandboxFn: func(_ context.Context, _, _ string, spec *openshellv1.SandboxSpec, _, _ map[string]string) (*openshellv1.Sandbox, error) {
			capturedSpec = spec
			return &openshellv1.Sandbox{
				Metadata: &datamodelv1.ObjectMeta{Id: "id-1", Name: "gpu-sandbox"},
				Status:   &openshellv1.SandboxStatus{Phase: openshellv1.SandboxPhase_SANDBOX_PHASE_PROVISIONING},
			}, nil
		},
	}
	app := newTestApp(mock)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/sandboxes", app.CreateSandbox)

	body := `{"name":"gpu-sandbox","image":"nvidia/cuda","gpuCount":2,"cpu":"4","memory":"8Gi","policy":{"version":1,"filesystem":{"includeWorkdir":true}}}`
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", w.Code, w.Body.String())
	}
	if capturedSpec.ResourceRequirements == nil || capturedSpec.ResourceRequirements.Gpu == nil {
		t.Fatal("expected GPU resource requirements to be set")
	}
	if capturedSpec.ResourceRequirements.Gpu.GetCount() != 2 {
		t.Errorf("gpu count = %d, want 2", capturedSpec.ResourceRequirements.Gpu.GetCount())
	}
	if capturedSpec.Template.Resources == nil {
		t.Fatal("expected template resources to be set for cpu/memory")
	}
}
