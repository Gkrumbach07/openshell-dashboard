package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func TestGetHealthz(t *testing.T) {
	app := newTestApp(&mockGateway{})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	app.GetHealthz(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status = %q, want ok", body["status"])
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestGetGateway(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context) (*openshellv1.GetGatewayInfoResponse, error)
		wantFields map[string]string
		name       string
		wantStatus int
	}{
		{
			name: "success with compute drivers",
			mockFn: func(_ context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
				return &openshellv1.GetGatewayInfoResponse{
					Status:         openshellv1.ServiceStatus_SERVICE_STATUS_HEALTHY,
					GatewayVersion: "0.0.92",
					ComputeDrivers: []*openshellv1.ComputeDriverInfo{
						{
							Name: "podman",
							Capabilities: &openshellv1.ComputeDriverCapabilities{
								DriverName:    "podman",
								DriverVersion: "5.0",
							},
						},
					},
				}, nil
			},
			wantStatus: http.StatusOK,
			wantFields: map[string]string{
				"status":         "HEALTHY",
				"gatewayVersion": "0.0.92",
			},
		},
		{
			name: "gateway unavailable",
			mockFn: func(_ context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
				return nil, status.Error(codes.Unavailable, "connection refused")
			},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "permission denied",
			mockFn: func(_ context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
				return nil, status.Error(codes.PermissionDenied, "not allowed")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getGatewayInfoFn: tc.mockFn})

			req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
			w := httptest.NewRecorder()
			app.GetGateway(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantFields != nil {
				var body map[string]any
				if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				for k, want := range tc.wantFields {
					if got, ok := body[k].(string); !ok || got != want {
						t.Errorf("%s = %v, want %q", k, body[k], want)
					}
				}
			}
		})
	}
}

func TestGetGatewayComputeDrivers(t *testing.T) {
	app := newTestApp(&mockGateway{
		getGatewayInfoFn: func(_ context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
			return &openshellv1.GetGatewayInfoResponse{
				Status:         openshellv1.ServiceStatus_SERVICE_STATUS_HEALTHY,
				GatewayVersion: "0.0.92",
				ComputeDrivers: []*openshellv1.ComputeDriverInfo{
					{
						Name: "podman",
						Capabilities: &openshellv1.ComputeDriverCapabilities{
							DriverName:    "podman",
							DriverVersion: "5.0",
						},
					},
					{
						Name: "kubernetes",
						Capabilities: &openshellv1.ComputeDriverCapabilities{
							DriverName: "kubernetes",
						},
					},
				},
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	app.GetGateway(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	drivers, ok := body["computeDrivers"].([]any)
	if !ok {
		t.Fatal("computeDrivers is not an array")
	}
	if len(drivers) != 2 {
		t.Fatalf("got %d drivers, want 2", len(drivers))
	}
	first, ok := drivers[0].(map[string]any)
	if !ok {
		t.Fatal("first driver is not a map")
	}
	if first["name"] != "podman" {
		t.Errorf("first driver name = %v, want podman", first["name"])
	}
}
