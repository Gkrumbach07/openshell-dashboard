package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
)

// A downstream host (RHOAI's agent-ops module) fronts several OpenShell installs
// from one process. This pins the contract that makes that possible:
//
//   - the packages are importable (they live in pkg/, not internal/)
//   - an App is bound to one gateway by its SDK client, so N gateways is N Apps
//   - Routes() is mountable under an arbitrary prefix
//   - staticDir "" yields an API-only surface, with no console file serving
//
// Auth stays per-request regardless: sdkclient.ContextAuthProvider reads the
// bearer off the request context on every gRPC call, so a per-gateway client
// still forwards each caller's own token.
func TestEmbeddingMultipleGatewaysInOneProcess(t *testing.T) {
	newGateway := func(version string) *App {
		sdk := &mockSDK{}
		sdk.health.getGatewayInfoFn = func(_ context.Context) (*openshell.GatewayInfo, error) {
			return &openshell.GatewayInfo{Status: openshell.ServiceStatusHealthy, Version: version}, nil
		}
		return NewApp(
			sdk,
			nil,
			auth.New(auth.Config{Disabled: true}),
			"", // API only — the embedding host renders the UI from the npm package
			AuthConfigResponse{AuthDisabled: true},
		)
	}

	// What the downstream router does: one App per install, mounted by id.
	gateways := map[string]*App{
		"prod":  newGateway("1.1.1"),
		"stage": newGateway("2.2.2"),
	}

	mux := chi.NewRouter()
	for id, app := range gateways {
		mux.Mount("/openshell/"+id, http.StripPrefix("/openshell/"+id, app.Routes()))
	}

	for id, wantVersion := range map[string]string{"prod": "1.1.1", "stage": "2.2.2"} {
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/openshell/"+id+"/api/v1/gateway", nil))

		if rr.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200 (body %s)", id, rr.Code, rr.Body.String())
		}
		var body map[string]any
		if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
			t.Fatalf("%s: decode: %v", id, err)
		}
		// Each mounted App reached its OWN gateway, not a shared one.
		if got, _ := body["gatewayVersion"].(string); got != wantVersion {
			if got, _ = body["version"].(string); got != wantVersion {
				t.Errorf("%s: gateway version = %v, want %s (body %v)", id, got, wantVersion, body)
			}
		}
	}
}

// An embedded App must not serve the standalone console's static assets.
func TestEmbeddedAppServesNoStaticAssets(t *testing.T) {
	app := NewApp(&mockSDK{}, nil, auth.New(auth.Config{Disabled: true}), "", AuthConfigResponse{AuthDisabled: true})

	rr := httptest.NewRecorder()
	app.Routes().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/index.html", nil))

	if rr.Code == http.StatusOK && strings.Contains(rr.Body.String(), "<html") {
		t.Error("embedded App served console HTML; staticDir \"\" must yield an API-only surface")
	}
}
