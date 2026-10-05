package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
