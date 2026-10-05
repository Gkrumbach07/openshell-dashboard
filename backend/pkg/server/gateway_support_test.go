package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"github.com/NVIDIA/OpenShell/sdk/go/openshell/v1/fake"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
)

// getGateway drives GET /api/v1/gateway through the real router of an App
// built the way main builds it, against a gateway reporting the given version.
func getGateway(t *testing.T, reported string, configure func(*App)) map[string]any {
	t.Helper()
	sdk := fake.NewClient(fake.WithGatewayInfo(&openshell.GatewayInfo{
		Status:  openshell.ServiceStatusHealthy,
		Version: reported,
	}))
	app := NewApp(sdk, nil, auth.New(auth.Config{Disabled: true}), "", models.AuthConfigResponse{AuthDisabled: true})
	if configure != nil {
		configure(app)
	}

	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/gateway", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/gateway = %d; body: %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body: %s", err, recorder.Body.String())
	}
	return body
}

// SetGatewaySupport is the only way a range reaches the route, so prove the
// wiring end to end rather than only the handler in isolation.
func TestSetGatewaySupport_ReachesGatewayRoute(t *testing.T) {
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}

	body := getGateway(t, "0.0.116", func(app *App) { app.SetGatewaySupport(support) })

	compatibility, ok := body["compatibility"].(map[string]any)
	if !ok {
		t.Fatalf("compatibility missing from %v", body)
	}
	if compatibility["status"] != "unsupported" || compatibility["supportedMin"] != "0.1.0" || compatibility["supportedMax"] != "0.1.2" {
		t.Errorf("compatibility = %v, want unsupported against 0.1.0..0.1.2", compatibility)
	}
	if body["gatewayVersion"] != "0.0.116" {
		t.Errorf("gatewayVersion = %v, want 0.0.116", body["gatewayVersion"])
	}
}

// adminOnlyGatewayInfo is an SDK client whose gateway refuses GetGatewayInfo,
// the way a real gateway refuses it to a caller without the platform-admin
// role. Every other call, the health check included, goes to the wrapped fake.
type adminOnlyGatewayInfo struct {
	openshell.ClientInterface
}

func (c adminOnlyGatewayInfo) Health() openshell.HealthInterface {
	return refusedGatewayInfo{c.ClientInterface.Health()}
}

type refusedGatewayInfo struct {
	openshell.HealthInterface
}

func (refusedGatewayInfo) GetGatewayInfo(context.Context) (*openshell.GatewayInfo, error) {
	return nil, &openshell.StatusError{Code: openshell.ErrorPermissionDenied, Message: "role 'openshell-admin' required"}
}

// A signed-in user who is not a platform admin: the gateway refuses the
// gateway-info call, and the verdict must reach them anyway. Driven through
// the real router with auth ON, the way a deployment behind a proxy runs.
func TestGatewayCompatibilityRoute_ServesUsersWithoutTheAdminRole(t *testing.T) {
	support, err := models.ParseGatewaySupport("0.1.0", "0.1.2")
	if err != nil {
		t.Fatalf("ParseGatewaySupport: %v", err)
	}
	sdk := adminOnlyGatewayInfo{fake.NewClient(fake.WithHealthResult(&openshell.HealthResult{
		Healthy: true,
		Version: "0.0.116",
	}))}
	app := NewApp(sdk, nil, auth.New(auth.Config{}), "", models.AuthConfigResponse{})
	app.SetGatewaySupport(support)
	router := app.Routes()

	get := func(path, token string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			request.Header.Set("x-forwarded-access-token", token)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}

	// The gateway-info route relays the refusal.
	if refused := get("/api/v1/gateway", "user-token"); refused.Code != http.StatusForbidden {
		t.Fatalf("GET /api/v1/gateway = %d, want 403; body: %s", refused.Code, refused.Body.String())
	}

	// The verdict route answers the same user.
	verdict := get("/api/v1/gateway/compatibility", "user-token")
	if verdict.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/gateway/compatibility = %d, want 200; body: %s", verdict.Code, verdict.Body.String())
	}
	var body struct {
		GatewayVersion string `json:"gatewayVersion"`
		Compatibility  struct {
			Status       string `json:"status"`
			SupportedMin string `json:"supportedMin"`
			SupportedMax string `json:"supportedMax"`
		} `json:"compatibility"`
	}
	if err := json.Unmarshal(verdict.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body: %s", err, verdict.Body.String())
	}
	if body.GatewayVersion != "0.0.116" || body.Compatibility.Status != "unsupported" ||
		body.Compatibility.SupportedMin != "0.1.0" || body.Compatibility.SupportedMax != "0.1.2" {
		t.Errorf("body = %s, want gateway 0.0.116 unsupported against 0.1.0..0.1.2", verdict.Body.String())
	}

	// "Every signed-in user", not everyone: the route is behind the same
	// bearer check as the rest of the API.
	if anonymous := get("/api/v1/gateway/compatibility", ""); anonymous.Code != http.StatusUnauthorized {
		t.Errorf("GET /api/v1/gateway/compatibility without a token = %d, want 401", anonymous.Code)
	}
}

// An App nobody gave a range to answers the verdict route too, with "unknown"
// and no range — the same answer GET /gateway gives.
func TestGatewayCompatibilityRoute_WithoutGatewaySupportReportsUnknown(t *testing.T) {
	sdk := fake.NewClient(fake.WithHealthResult(&openshell.HealthResult{Healthy: true, Version: "0.0.116"}))
	app := NewApp(sdk, nil, auth.New(auth.Config{Disabled: true}), "", models.AuthConfigResponse{AuthDisabled: true})

	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/gateway/compatibility", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/gateway/compatibility = %d; body: %s", recorder.Code, recorder.Body.String())
	}
	const want = `{"gatewayVersion":"0.0.116","compatibility":{"status":"unknown"}}`
	if got := strings.TrimSpace(recorder.Body.String()); got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

// An App nobody gave a range to — every existing caller of NewApp — reports
// "unknown" and names no range. It must never invent one.
func TestNewApp_WithoutGatewaySupportReportsUnknown(t *testing.T) {
	body := getGateway(t, "0.0.116", nil)

	compatibility, ok := body["compatibility"].(map[string]any)
	if !ok {
		t.Fatalf("compatibility missing from %v", body)
	}
	if len(compatibility) != 1 || compatibility["status"] != "unknown" {
		t.Errorf("compatibility = %v, want only status unknown", compatibility)
	}
}
