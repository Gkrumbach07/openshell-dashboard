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

	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
)

func TestGetInferenceRoute(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, routeName string) (*inferencev1.GetInferenceRouteResponse, error)
		name       string
		url        string
		wantStatus int
	}{
		{
			name: "success default route",
			url:  "/workspaces/default/inference",
			mockFn: func(_ context.Context, _, _ string) (*inferencev1.GetInferenceRouteResponse, error) {
				return &inferencev1.GetInferenceRouteResponse{
					RouteName:    "inference.local",
					ProviderName: "claude",
					ModelId:      "claude-sonnet-5",
					Version:      1,
					TimeoutSecs:  30,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "success system route",
			url:  "/workspaces/default/inference?route=sandbox-system",
			mockFn: func(_ context.Context, _, route string) (*inferencev1.GetInferenceRouteResponse, error) {
				if route != "sandbox-system" {
					t.Errorf("route = %q, want sandbox-system", route)
				}
				return &inferencev1.GetInferenceRouteResponse{
					RouteName:    "sandbox-system",
					ProviderName: "nim",
					ModelId:      "llama-3",
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			url:  "/workspaces/default/inference",
			mockFn: func(_ context.Context, _, _ string) (*inferencev1.GetInferenceRouteResponse, error) {
				return nil, status.Error(codes.NotFound, "no route configured")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getInferenceRouteFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/inference", app.GetInferenceRoute)

			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestGetInferenceRouteBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		getInferenceRouteFn: func(_ context.Context, _, _ string) (*inferencev1.GetInferenceRouteResponse, error) {
			return &inferencev1.GetInferenceRouteResponse{
				RouteName:    "inference.local",
				ProviderName: "claude",
				ModelId:      "claude-sonnet-5",
				Version:      2,
				TimeoutSecs:  60,
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/inference", app.GetInferenceRoute)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/inference", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["providerName"] != "claude" {
		t.Errorf("providerName = %v", body["providerName"])
	}
	if body["modelId"] != "claude-sonnet-5" {
		t.Errorf("modelId = %v", body["modelId"])
	}
	if body["version"].(float64) != 2 {
		t.Errorf("version = %v, want 2", body["version"])
	}
}

func TestSetInferenceRoute(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, routeName, providerName, modelID string, timeoutSecs uint64, noVerify bool) (*inferencev1.SetInferenceRouteResponse, error)
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"providerName":"claude","modelId":"claude-sonnet-5","timeoutSecs":30}`,
			mockFn: func(_ context.Context, _, _, _, _ string, _ uint64, _ bool) (*inferencev1.SetInferenceRouteResponse, error) {
				return &inferencev1.SetInferenceRouteResponse{
					RouteName:    "inference.local",
					ProviderName: "claude",
					ModelId:      "claude-sonnet-5",
					Version:      1,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing provider",
			body:       `{"modelId":"model"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_route",
		},
		{
			name:       "missing model",
			body:       `{"providerName":"claude"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_route",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{setInferenceRouteFn: tc.mockFn})
			r := chi.NewRouter()
			r.Put("/workspaces/{workspace}/inference", app.SetInferenceRoute)

			req := httptest.NewRequest(http.MethodPut, "/workspaces/default/inference", strings.NewReader(tc.body))
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

func TestDeleteInferenceRoute(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, routeName string) (*inferencev1.DeleteInferenceRouteResponse, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, _ string) (*inferencev1.DeleteInferenceRouteResponse, error) {
				return &inferencev1.DeleteInferenceRouteResponse{Deleted: true}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _ string) (*inferencev1.DeleteInferenceRouteResponse, error) {
				return nil, status.Error(codes.NotFound, "no route")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{deleteInferenceRouteFn: tc.mockFn})
			r := chi.NewRouter()
			r.Delete("/workspaces/{workspace}/inference", app.DeleteInferenceRoute)

			req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/inference", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}
