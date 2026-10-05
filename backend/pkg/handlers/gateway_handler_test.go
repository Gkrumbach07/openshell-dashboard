package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

// GET /gateway carries the dashboard's verdict on the gateway's version. The
// three gateways here are the ones that matter today: the release the 0.x
// line serves, the newest release this line is tested against, and upstream
// HEAD. Each body is logged, so `go test -v -run TestGetGatewayCompatibility`
// shows exactly what the frontend receives.
func TestGetGatewayCompatibility(t *testing.T) {
	tests := []struct { //nolint:govet // fieldalignment: test readability
		name       string
		minVersion string
		maxVersion string
		reported   string
		want       map[string]any
	}{
		{
			name:       "gateway older than the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.0.116",
			want:     map[string]any{"status": "unsupported", "supportedMin": "0.1.0", "supportedMax": "0.1.2"},
		},
		{
			name:       "gateway inside the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.1.2",
			want:     map[string]any{"status": "supported", "supportedMin": "0.1.0", "supportedMax": "0.1.2"},
		},
		{
			name:       "gateway newer than the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.1.3-dev.84+ge7fdd6bee",
			want:     map[string]any{"status": "untested", "supportedMin": "0.1.0", "supportedMax": "0.1.2"},
		},
		{
			name:       "gateway version unreadable",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "",
			want:     map[string]any{"status": "unknown", "supportedMin": "0.1.0", "supportedMax": "0.1.2"},
		},
		{
			// No range configured: the BFF does not guess one, even for a
			// gateway it would otherwise call unsupported.
			name:     "no range configured",
			reported: "0.0.116",
			want:     map[string]any{"status": "unknown"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
				return &openshell.GatewayInfo{
					Status:         openshell.ServiceStatusHealthy,
					Version:        tc.reported,
					ComputeDrivers: []openshell.ComputeDriverInfo{{Name: "podman"}},
				}, nil
			}
			support, err := models.ParseGatewaySupport(tc.minVersion, tc.maxVersion)
			if err != nil {
				t.Fatalf("ParseGatewaySupport: %v", err)
			}
			handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
			handler.SetGatewaySupport(support)

			w := httptest.NewRecorder()
			handler.GetGateway(w, httptest.NewRequest(http.MethodGet, "/gateway", nil))

			// Informational only: an out-of-range gateway is still a 200.
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
			}
			t.Logf("gateway %q, range %q -> %s", tc.reported, support.String(), w.Body.String())

			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			// The gateway's own fields are passed through untouched.
			if body["status"] != "HEALTHY" || body["gatewayVersion"] != tc.reported {
				t.Errorf("gateway fields changed: %v", body)
			}
			got, ok := body["compatibility"].(map[string]any)
			if !ok {
				t.Fatalf("compatibility is missing or not an object: %v", body)
			}
			if len(got) != len(tc.want) {
				t.Errorf("compatibility = %v, want %v", got, tc.want)
			}
			for key, want := range tc.want {
				if got[key] != want {
					t.Errorf("compatibility.%s = %v, want %v", key, got[key], want)
				}
			}
		})
	}
}

// A gateway that cannot be reached has no version to judge, so the error is
// relayed as before rather than dressed up as a compatibility result.
func TestGetGatewayUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "down"}
	}
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}
	handler.SetGatewaySupport(support)
	req := httptest.NewRequest(http.MethodGet, "/gateway", nil)
	w := httptest.NewRecorder()
	handler.GetGateway(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
}

// The gateway refuses GetGatewayInfo to anyone who is not a platform admin
// ("role 'openshell-admin' required"), yet a gateway that is too old breaks
// that user's pages just the same. The verdict therefore has a route of its
// own that reads the version from the health check, which needs no role.
func TestGetGatewayCompatibilityNeedsNoAdminRole(t *testing.T) {
	sdk := &mockSDK{}
	gatewayInfoCalls := 0
	sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
		gatewayInfoCalls++
		return nil, &openshell.StatusError{Code: openshell.ErrorPermissionDenied, Message: "role 'openshell-admin' required"}
	}
	sdk.health.checkFn = func(_ context.Context) (*openshell.HealthResult, error) {
		return &openshell.HealthResult{Healthy: true, Version: "0.0.116"}, nil
	}
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}
	handler.SetGatewaySupport(support)

	// The admin-only route stays refused: the BFF relays the gateway's answer
	// and does not paper over it.
	refused := httptest.NewRecorder()
	handler.GetGateway(refused, httptest.NewRequest(http.MethodGet, "/gateway", nil))
	if refused.Code != http.StatusForbidden {
		t.Fatalf("GET /gateway = %d, want 403; body: %s", refused.Code, refused.Body.String())
	}

	// The verdict is not refused.
	w := httptest.NewRecorder()
	handler.GetGatewayCompatibility(w, httptest.NewRequest(http.MethodGet, "/gateway/compatibility", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /gateway/compatibility = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	t.Logf("GetGatewayInfo refused -> %s", w.Body.String())
	const want = `{"gatewayVersion":"0.0.116","compatibility":{"status":"unsupported","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`
	if got := strings.TrimSpace(w.Body.String()); got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
	// And it never touched the call that would have refused it.
	if gatewayInfoCalls != 1 {
		t.Errorf("GetGatewayInfo was called %d times, want 1 (by GET /gateway only)", gatewayInfoCalls)
	}
}

// GET /gateway/compatibility judges the version the health check reports the
// same way GET /gateway judges the one GetGatewayInfo reports. Each body is
// logged, so `go test -v -run TestGetGatewayCompatibilityRoute` shows exactly
// what the notice in the UI receives.
func TestGetGatewayCompatibilityRoute(t *testing.T) {
	tests := []struct { //nolint:govet // fieldalignment: test readability
		name       string
		minVersion string
		maxVersion string
		reported   string
		want       string
	}{
		{
			name:       "gateway older than the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.0.116",
			want:     `{"gatewayVersion":"0.0.116","compatibility":{"status":"unsupported","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`,
		},
		{
			name:       "gateway inside the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.1.2",
			want:     `{"gatewayVersion":"0.1.2","compatibility":{"status":"supported","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`,
		},
		{
			name:       "gateway newer than the range",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.1.3-dev.84+ge7fdd6bee",
			want:     `{"gatewayVersion":"0.1.3-dev.84+ge7fdd6bee","compatibility":{"status":"untested","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`,
		},
		{
			// The version is passed through as reported; only the verdict
			// reads it as the release it rebuilds.
			name:       "downstream rebuild of the minimum",
			minVersion: "0.1.2", maxVersion: "0.1.2",
			reported: "0.1.2-rhaiv.5",
			want:     `{"gatewayVersion":"0.1.2-rhaiv.5","compatibility":{"status":"supported","supportedMin":"0.1.2","supportedMax":"0.1.2"}}`,
		},
		{
			name:       "gateway that does not know its own version",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "0.0.0",
			want:     `{"gatewayVersion":"0.0.0","compatibility":{"status":"unknown","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`,
		},
		{
			name:       "gateway version empty",
			minVersion: "0.1.0", maxVersion: "0.1.2",
			reported: "",
			want:     `{"gatewayVersion":"","compatibility":{"status":"unknown","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`,
		},
		{
			name:     "no range configured",
			reported: "0.0.116",
			want:     `{"gatewayVersion":"0.0.116","compatibility":{"status":"unknown"}}`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.health.checkFn = func(_ context.Context) (*openshell.HealthResult, error) {
				return &openshell.HealthResult{Healthy: true, Version: tc.reported}, nil
			}
			support, err := models.ParseGatewaySupport(tc.minVersion, tc.maxVersion)
			if err != nil {
				t.Fatalf("ParseGatewaySupport: %v", err)
			}
			handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
			handler.SetGatewaySupport(support)

			w := httptest.NewRecorder()
			handler.GetGatewayCompatibility(w, httptest.NewRequest(http.MethodGet, "/gateway/compatibility", nil))

			// Informational only: an out-of-range gateway is still a 200.
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
			}
			t.Logf("gateway %q, range %q -> %s", tc.reported, support.String(), w.Body.String())
			if got := strings.TrimSpace(w.Body.String()); got != tc.want {
				t.Errorf("body = %s, want %s", got, tc.want)
			}
		})
	}
}

// With the gateway down there is no version to judge. The error is relayed
// with the same status as on every other route, not turned into "unknown".
func TestGetGatewayCompatibilityUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.health.checkFn = func(_ context.Context) (*openshell.HealthResult, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "down"}
	}
	handler := NewGatewayHandler(services.NewGatewayService(sdk), auth.New(auth.Config{}), models.AuthConfigResponse{})
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}
	handler.SetGatewaySupport(support)

	w := httptest.NewRecorder()
	handler.GetGatewayCompatibility(w, httptest.NewRequest(http.MethodGet, "/gateway/compatibility", nil))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502; body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "compatibility") {
		t.Errorf("an unreachable gateway was given a verdict: %s", w.Body.String())
	}
}

// infoOnlyGatewayService is a downstream gateway service written against
// GatewayServiceInterface alone, before the verdict had a route of its own:
// it has no GetGatewayVersion.
type infoOnlyGatewayService struct {
	info *models.GatewayInfo
	err  error
}

func (s infoOnlyGatewayService) GetGatewayInfo(context.Context) (*models.GatewayInfo, error) {
	return s.info, s.err
}
func (infoOnlyGatewayService) CheckHealth(context.Context) error { return nil }
func (infoOnlyGatewayService) GetCurrentUser(context.Context) (*models.CurrentUser, error) {
	return &models.CurrentUser{}, nil
}

// Such a service still compiles and still gets a verdict, from the only
// version source it has. That source is admin-only, so its refusal is relayed.
func TestGetGatewayCompatibilityFallsBackToGatewayInfo(t *testing.T) {
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}
	get := func(svc services.GatewayServiceInterface) *httptest.ResponseRecorder {
		handler := NewGatewayHandler(svc, auth.New(auth.Config{}), models.AuthConfigResponse{})
		handler.SetGatewaySupport(support)
		w := httptest.NewRecorder()
		handler.GetGatewayCompatibility(w, httptest.NewRequest(http.MethodGet, "/gateway/compatibility", nil))
		return w
	}

	w := get(infoOnlyGatewayService{info: &models.GatewayInfo{Status: "HEALTHY", GatewayVersion: "0.0.116"}})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	const want = `{"gatewayVersion":"0.0.116","compatibility":{"status":"unsupported","supportedMin":"0.1.0","supportedMax":"0.1.2"}}`
	if got := strings.TrimSpace(w.Body.String()); got != want {
		t.Errorf("body = %s, want %s", got, want)
	}

	w = get(infoOnlyGatewayService{err: &openshell.StatusError{Code: openshell.ErrorPermissionDenied, Message: "role 'openshell-admin' required"}})
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 relayed from GetGatewayInfo; body: %s", w.Code, w.Body.String())
	}

	// A service that answers with nothing has no version to judge.
	w = get(infoOnlyGatewayService{})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"unknown"`) {
		t.Errorf("nil info: status = %d, body = %s; want 200 with status unknown", w.Code, w.Body.String())
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
