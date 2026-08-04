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

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func TestListServices(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, sandbox string) ([]*openshellv1.ServiceEndpointResponse, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _ string) ([]*openshellv1.ServiceEndpointResponse, error) {
				return []*openshellv1.ServiceEndpointResponse{
					{
						Endpoint: &openshellv1.ServiceEndpoint{
							SandboxName: "my-sandbox",
							ServiceName: "web",
							TargetPort:  8080,
						},
						Url: "https://web.example.com",
					},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "empty list",
			mockFn: func(_ context.Context, _, _ string) ([]*openshellv1.ServiceEndpointResponse, error) {
				return nil, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "gateway error",
			mockFn: func(_ context.Context, _, _ string) ([]*openshellv1.ServiceEndpointResponse, error) {
				return nil, status.Error(codes.Unavailable, "gateway down")
			},
			wantStatus: http.StatusBadGateway,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{listServicesFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/sandboxes/{name}/services", app.ListServices)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/services", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestListServicesBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		listServicesFn: func(_ context.Context, _, _ string) ([]*openshellv1.ServiceEndpointResponse, error) {
			return []*openshellv1.ServiceEndpointResponse{
				{
					Endpoint: &openshellv1.ServiceEndpoint{
						SandboxName: "my-sandbox",
						ServiceName: "web",
						TargetPort:  8080,
						Domain:      true,
					},
					Url: "https://web.example.com",
				},
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/services", app.ListServices)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/services", nil)
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
		t.Fatalf("got %d services, want 1", len(body))
	}
	if body[0]["serviceName"] != "web" {
		t.Errorf("serviceName = %v", body[0]["serviceName"])
	}
	if body[0]["url"] != "https://web.example.com" {
		t.Errorf("url = %v", body[0]["url"])
	}
}

func TestExposeService(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, sandbox, service string, targetPort uint32, domain bool) (*openshellv1.ServiceEndpointResponse, error)
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"service":"web","targetPort":8080,"domain":true}`,
			mockFn: func(_ context.Context, _, _, _ string, _ uint32, _ bool) (*openshellv1.ServiceEndpointResponse, error) {
				return &openshellv1.ServiceEndpointResponse{
					Endpoint: &openshellv1.ServiceEndpoint{
						SandboxName: "my-sandbox",
						ServiceName: "web",
						TargetPort:  8080,
						Domain:      true,
					},
					Url: "https://web.example.com",
				}, nil
			},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing service name",
			body:       `{"targetPort":8080}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_service",
		},
		{
			name:       "missing target port",
			body:       `{"service":"web"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_port",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{exposeServiceFn: tc.mockFn})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/services", app.ExposeService)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/services", strings.NewReader(tc.body))
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

func TestDeleteService(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, sandbox, service string) (bool, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _, _ string) (bool, error) {
				return true, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _, _ string) (bool, error) {
				return false, status.Error(codes.NotFound, "service not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{deleteServiceFn: tc.mockFn})
			r := chi.NewRouter()
			r.Delete("/workspaces/{workspace}/sandboxes/{name}/services/{svc}", app.DeleteService)

			req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/sandboxes/my-sandbox/services/web", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}
