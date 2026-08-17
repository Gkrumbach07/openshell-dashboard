package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestGetGlobalSettings(t *testing.T) {
	sdk := &mockSDK{}
	sdk.config.getGatewayFn = func(_ context.Context) (*openshell.GatewayConfig, error) {
		return &openshell.GatewayConfig{
			SettingsRevision: 9,
			Settings: map[string]openshell.SettingValue{
				"log_level": {Type: openshell.SettingValueString, StringVal: "info"},
				"enabled":   {Type: openshell.SettingValueBool, BoolVal: true},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	req := httptest.NewRequest(http.MethodGet, "/settings/global", nil)
	w := httptest.NewRecorder()
	app.GetGlobalSettings(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["settingsRevision"] != float64(9) {
		t.Errorf("settingsRevision = %v", body["settingsRevision"])
	}
	settings, _ := body["settings"].([]any)
	if len(settings) != 2 {
		t.Fatalf("got %d settings, want 2", len(settings))
	}
}

func TestSetGlobalSetting(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "success", body: `{"key":"log_level","value":"debug"}`, wantStatus: http.StatusOK},
		{name: "missing key", body: `{"key":"","value":"x"}`, wantStatus: http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithSDK(&mockSDK{})
			req := httptest.NewRequest(http.MethodPut, "/settings/global", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			app.SetGlobalSetting(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteGlobalSetting(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	req := httptest.NewRequest(http.MethodDelete, "/settings/global?key=log_level", nil)
	w := httptest.NewRecorder()
	app.DeleteGlobalSetting(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestDeleteGlobalSettingMissingKey(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	req := httptest.NewRequest(http.MethodDelete, "/settings/global", nil)
	w := httptest.NewRecorder()
	app.DeleteGlobalSetting(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
