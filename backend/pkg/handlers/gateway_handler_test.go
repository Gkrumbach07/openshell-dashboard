package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

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
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	handler.GetGateway(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
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
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	handler.GetGateway(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
}

func TestGetReadyz(t *testing.T) {
	handler := NewGatewayHandler(services.NewGatewayService(&mockSDK{}), auth.New(auth.Config{}), models.AuthConfigResponse{})
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	handler.GetReadyz(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestGetReadyzUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.checkFn = func(_ context.Context) (*openshell.HealthResult, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "down"}
	}
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	handler.GetReadyz(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestGetWhoAmIAuthDisabled(t *testing.T) {
	handler := NewGatewayHandler(
		services.NewGatewayService(&mockSDK{}),
		auth.New(auth.Config{Disabled: true}),
		models.AuthConfigResponse{AdminRole: "openshell-admin"},
	)
	req := httptest.NewRequest(http.MethodGet, "/auth/whoami", nil)
	w := httptest.NewRecorder()
	handler.GetWhoAmI(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["subject"] != "dev-user" {
		t.Errorf("subject = %v", body["subject"])
	}
}
