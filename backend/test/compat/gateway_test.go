//go:build compat

package compat

import (
	"net/http"
	"testing"
)

// Ports cypress/e2e-integration/gateway.cy.ts.
func TestGatewayInfo(t *testing.T) {
	var info struct {
		Status         string `json:"status"`
		GatewayVersion string `json:"gatewayVersion"`
		ComputeDrivers []struct {
			Name string `json:"name"`
		} `json:"computeDrivers"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/gateway", nil, &info, http.StatusOK)

	if info.Status != "HEALTHY" {
		t.Errorf("status = %q, want HEALTHY", info.Status)
	}
	if info.GatewayVersion == "" {
		t.Error("gatewayVersion is empty — GetGatewayInfo no longer reports a version")
	}
	if len(info.ComputeDrivers) == 0 {
		t.Fatal("computeDrivers is empty — the gateway reported no compute drivers")
	}
	if info.ComputeDrivers[0].Name == "" {
		t.Error("computeDrivers[0].name is empty")
	}
}

func TestHealthz(t *testing.T) {
	var body struct {
		Status string `json:"status"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/healthz", nil, &body, http.StatusOK)
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
}

// Readyz proves the BFF can actually reach the gateway, which healthz does not.
func TestReadyz(t *testing.T) {
	var body struct {
		Status string `json:"status"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/readyz", nil, &body, http.StatusOK)
	if body.Status != "ready" {
		t.Errorf("status = %q, want ready", body.Status)
	}
}

func TestAuthConfig(t *testing.T) {
	var cfg struct {
		AuthDisabled bool `json:"authDisabled"`
	}
	mustJSON(t, http.MethodGet, "/api/v1/auth/config", nil, &cfg, http.StatusOK)
	if !cfg.AuthDisabled {
		t.Error("authDisabled = false, want true (the compat stack runs with AUTH_DISABLED=true)")
	}
}
