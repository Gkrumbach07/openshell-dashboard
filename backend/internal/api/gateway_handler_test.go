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

func TestGetAuthConfig(t *testing.T) {
	t.Run("advertises the gateway's identity domain", func(t *testing.T) {
		app := newTestAppWithSDK(&mockSDK{})
		app.authConfig = AuthConfigResponse{
			AdminRole:  "openshell-admin",
			LogoutURL:  "/oauth2/sign_out",
			Issuer:     "https://idp.example/realms/openshell",
			ClientID:   "openshell-dashboard",
			Audience:   "openshell-gateway",
			Scope:      "openid profile",
			APIVersion: "0.1.3",
			Features:   FeatureFlags{Terminal: true, FileTransfer: true},
		}

		w := httptest.NewRecorder()
		app.GetAuthConfig(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}

		var body map[string]any
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for key, want := range map[string]string{
			"issuer":     "https://idp.example/realms/openshell",
			"clientId":   "openshell-dashboard",
			"audience":   "openshell-gateway",
			"scope":      "openid profile",
			"apiVersion": "0.1.3",
		} {
			if got, _ := body[key].(string); got != want {
				t.Errorf("%s = %q, want %q", key, got, want)
			}
		}
	})

	t.Run("never leaks a credential", func(t *testing.T) {
		// The endpoint is public — it answers before any token exists — so it must
		// carry only client metadata. A secret reaching it would be served
		// unauthenticated to anyone who can hit the BFF.
		app := newTestAppWithSDK(&mockSDK{})
		app.authConfig = AuthConfigResponse{
			Issuer:   "https://idp.example/realms/openshell",
			ClientID: "openshell-dashboard",
		}

		w := httptest.NewRecorder()
		app.GetAuthConfig(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil))

		var body map[string]any
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, forbidden := range []string{"clientSecret", "client_secret", "token", "secret", "password"} {
			if _, present := body[forbidden]; present {
				t.Errorf("auth config exposed %q", forbidden)
			}
		}
	})

	t.Run("omits OIDC fields when unset", func(t *testing.T) {
		// A standalone deployment has a fronting proxy doing sign-in and advertises
		// nothing; the response must not carry empty keys an embedding host would
		// read as a configured-but-blank issuer.
		app := newTestAppWithSDK(&mockSDK{})
		app.authConfig = AuthConfigResponse{AuthDisabled: true}

		w := httptest.NewRecorder()
		app.GetAuthConfig(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil))

		var body map[string]any
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, key := range []string{"issuer", "clientId", "audience", "apiVersion"} {
			if _, present := body[key]; present {
				t.Errorf("%s should be omitted when unset", key)
			}
		}
		if body["authDisabled"] != true {
			t.Errorf("authDisabled = %v, want true", body["authDisabled"])
		}
	})

	t.Run("is reachable without a bearer", func(t *testing.T) {
		// Registered outside the auth middleware group in Routes(); this pins that
		// so a future refactor cannot quietly move it behind auth and deadlock the
		// frontend's bootstrap.
		app := newTestAppWithSDK(&mockSDK{})
		app.auth = auth.New(auth.Config{})
		app.authConfig = AuthConfigResponse{Issuer: "https://idp.example"}

		w := httptest.NewRecorder()
		app.Routes().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 without a bearer", w.Code)
		}
	})
}
