package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

func TestGetHealthz(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
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
}

func TestGetGateway(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
		return &openshell.GatewayInfo{
			Status:  openshell.ServiceStatusHealthy,
			Version: "0.0.92",
			ComputeDrivers: []openshell.ComputeDriverInfo{
				{Name: "podman", DriverName: "podman", DriverVersion: "5.0"},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	app.GetGateway(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "HEALTHY" || body["gatewayVersion"] != "0.0.92" {
		t.Errorf("body = %v", body)
	}
	drivers, _ := body["computeDrivers"].([]any)
	if len(drivers) != 1 {
		t.Fatalf("got %d drivers, want 1", len(drivers))
	}
}

func TestGetGatewayUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "down"}
	}
	app := newTestAppWithSDK(sdk)
	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	app.GetGateway(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
}

func TestGetReadyz(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	app.GetReadyz(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetReadyzUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.checkFn = func(_ context.Context) (*openshell.HealthResult, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "down"}
	}
	app := newTestAppWithSDK(sdk)
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	app.GetReadyz(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestGetWhoAmIAuthDisabled(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	app.auth = auth.New(auth.Config{Disabled: true})
	app.authConfig = AuthConfigResponse{AdminRole: "openshell-admin"}
	req := httptest.NewRequest(http.MethodGet, "/auth/whoami", nil)
	w := httptest.NewRecorder()
	app.GetWhoAmI(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["subject"] != "dev-user" {
		t.Errorf("subject = %v", body["subject"])
	}
}
