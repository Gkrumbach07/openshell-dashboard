package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sandboxv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/sandboxv1"
)

func TestGetGlobalSettings(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context) (*sandboxv1.GetGatewayConfigResponse, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
				return &sandboxv1.GetGatewayConfigResponse{
					Settings: map[string]*sandboxv1.SettingValue{
						"max_sandboxes": {Value: &sandboxv1.SettingValue_IntValue{IntValue: 100}},
						"debug":         {Value: &sandboxv1.SettingValue_BoolValue{BoolValue: true}},
					},
					SettingsRevision: 5,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "gateway error",
			mockFn: func(_ context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
				return nil, status.Error(codes.PermissionDenied, "not admin")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getGatewaySettingsFn: tc.mockFn})

			req := httptest.NewRequest(http.MethodGet, "/settings/global", nil)
			w := httptest.NewRecorder()
			app.GetGlobalSettings(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestGetGlobalSettingsBody(t *testing.T) {
	app := newTestApp(&mockGateway{
		getGatewaySettingsFn: func(_ context.Context) (*sandboxv1.GetGatewayConfigResponse, error) {
			return &sandboxv1.GetGatewayConfigResponse{
				Settings: map[string]*sandboxv1.SettingValue{
					"debug":         {Value: &sandboxv1.SettingValue_BoolValue{BoolValue: true}},
					"max_sandboxes": {Value: &sandboxv1.SettingValue_IntValue{IntValue: 100}},
				},
				SettingsRevision: 7,
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/settings/global", nil)
	w := httptest.NewRecorder()
	app.GetGlobalSettings(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if v, ok := body["settingsRevision"].(float64); !ok || v != 7 {
		t.Errorf("settingsRevision = %v, want 7", body["settingsRevision"])
	}
	settings, ok := body["settings"].([]any)
	if !ok {
		t.Fatal("settings is not an array")
	}
	if len(settings) != 2 {
		t.Fatalf("got %d settings, want 2", len(settings))
	}
	first, ok := settings[0].(map[string]any)
	if !ok {
		t.Fatal("first setting is not a map")
	}
	if first["key"] != "debug" {
		t.Errorf("first key = %v, want debug (sorted)", first["key"])
	}
}

func TestSetGlobalSetting(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, key, value string) error
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			body: `{"key":"max_sandboxes","value":"200"}`,
			mockFn: func(_ context.Context, _, _ string) error {
				return nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing key",
			body:       `{"value":"200"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_setting",
		},
		{
			name: "gateway error",
			body: `{"key":"readonly","value":"x"}`,
			mockFn: func(_ context.Context, _, _ string) error {
				return status.Error(codes.PermissionDenied, "not admin")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{setSettingFn: tc.mockFn})

			req := httptest.NewRequest(http.MethodPut, "/settings/global", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			app.SetGlobalSetting(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestDeleteGlobalSetting(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, key string) error
		name       string
		url        string
		wantCode   string
		wantStatus int
	}{
		{
			name: "success",
			url:  "/settings/global?key=max_sandboxes",
			mockFn: func(_ context.Context, _ string) error {
				return nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing key",
			url:        "/settings/global",
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_setting",
		},
		{
			name: "gateway error",
			url:  "/settings/global?key=readonly",
			mockFn: func(_ context.Context, _ string) error {
				return status.Error(codes.PermissionDenied, "not admin")
			},
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{deleteSettingFn: tc.mockFn})

			req := httptest.NewRequest(http.MethodDelete, tc.url, nil)
			w := httptest.NewRecorder()
			app.DeleteGlobalSetting(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}
