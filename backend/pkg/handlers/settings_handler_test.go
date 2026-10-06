package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// The gateway's settings are typed and the read keeps the type: a bool comes
// back as a JSON boolean, an int as a number, a string as a string. A setting
// the gateway knows but that was never set has no value and no type, and is
// listed without one.
func TestGetGlobalSettings(t *testing.T) {
	sdk := &mockSDK{}
	sdk.config.getGatewayFn = func(_ context.Context) (*openshell.GatewayConfig, error) {
		return &openshell.GatewayConfig{
			SettingsRevision: 9,
			Settings: map[string]openshell.SettingValue{
				"proposal_approval_mode": {Type: openshell.SettingValueString, StringVal: "manual"},
				"ocsf_schema_version":    {Type: openshell.SettingValueString, StringVal: ""},
				"ocsf_json_enabled":      {Type: openshell.SettingValueBool, BoolVal: false},
				"retries":                {Type: openshell.SettingValueInt, IntVal: 3},
				"never_set":              {},
			},
		}, nil
	}
	handler := NewSettingsHandler(sdk.Config())
	req := httptest.NewRequest(http.MethodGet, "/settings/global", nil)
	w := httptest.NewRecorder()
	handler.GetGlobalSettings(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}
	var body struct {
		Settings []struct {
			Value *json.RawMessage `json:"value"`
			Key   string           `json:"key"`
		} `json:"settings"`
		SettingsRevision uint64 `json:"settingsRevision"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.SettingsRevision != 9 {
		t.Errorf("settingsRevision = %d, want 9", body.SettingsRevision)
	}
	// Sorted by key, each value in the JSON type the gateway has it in. A set
	// but empty string is a value; only the never-set key has none.
	want := []struct{ key, value string }{
		{"never_set", ""},
		{"ocsf_json_enabled", "false"},
		{"ocsf_schema_version", `""`},
		{"proposal_approval_mode", `"manual"`},
		{"retries", "3"},
	}
	if len(body.Settings) != len(want) {
		t.Fatalf("got %d settings, want %d: %+v", len(body.Settings), len(want), body.Settings)
	}
	for i, expected := range want {
		got := body.Settings[i]
		value := ""
		if got.Value != nil {
			value = string(*got.Value)
		}
		if got.Key != expected.key || value != expected.value {
			t.Errorf("settings[%d] = %s: %s, want %s: %s", i, got.Key, value, expected.key, expected.value)
		}
	}
}

// The JSON type of the value selects the kind the gateway is sent, because the
// gateway type-checks every setting. Nothing is coerced: "true" is a string.
func TestSetGlobalSetting(t *testing.T) {
	tests := []struct {
		want       *openshell.SettingValue
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name: "string", body: `{"key":"proposal_approval_mode","value":"auto"}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueString, StringVal: "auto"},
		},
		{
			name: "empty string is a value", body: `{"key":"ocsf_schema_version","value":""}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueString, StringVal: ""},
		},
		{
			name: "bool true", body: `{"key":"ocsf_json_enabled","value":true}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueBool, BoolVal: true},
		},
		{
			name: "bool false", body: `{"key":"ocsf_json_enabled","value":false}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueBool, BoolVal: false},
		},
		{
			name: "int", body: `{"key":"retries","value":-3}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueInt, IntVal: -3},
		},
		{
			name: "a quoted bool stays a string", body: `{"key":"ocsf_json_enabled","value":"true"}`, wantStatus: http.StatusOK,
			want: &openshell.SettingValue{Type: openshell.SettingValueString, StringVal: "true"},
		},
		{name: "missing key", body: `{"key":"","value":"x"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
		{name: "missing value", body: `{"key":"retries"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
		{name: "null value", body: `{"key":"retries","value":null}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
		{name: "fraction", body: `{"key":"retries","value":1.5}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
		{name: "object", body: `{"key":"retries","value":{"boolValue":true}}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
		{name: "array", body: `{"key":"retries","value":[1]}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_setting"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got *openshell.ConfigUpdate
			mock := &mockSDK{}
			mock.config.updateFn = func(_ context.Context, _ string, update *openshell.ConfigUpdate) (*openshell.ConfigUpdateResult, error) {
				got = update
				return &openshell.ConfigUpdateResult{}, nil
			}
			handler := NewSettingsHandler(mock.Config())
			req := httptest.NewRequest(http.MethodPut, "/settings/global", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			handler.SetGlobalSetting(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var body map[string]any
				if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if body["code"] != tc.wantCode {
					t.Errorf("code = %v, want %q", body["code"], tc.wantCode)
				}
				if got != nil {
					t.Errorf("a refused value still reached the gateway: %+v", got.SettingValue)
				}
				return
			}
			if got == nil || got.SettingValue == nil {
				t.Fatal("the gateway was not sent a setting value")
			}
			if !got.Global || got.DeleteSetting {
				t.Errorf("update = global %v, delete %v; want a global upsert", got.Global, got.DeleteSetting)
			}
			if !reflect.DeepEqual(got.SettingValue, tc.want) {
				t.Errorf("setting value = %+v, want %+v", *got.SettingValue, *tc.want)
			}
		})
	}
}

func TestDeleteGlobalSetting(t *testing.T) {
	mock := &mockSDK{}
	handler := NewSettingsHandler(mock.Config())
	req := httptest.NewRequest(http.MethodDelete, "/settings/global?key=log_level", nil)
	w := httptest.NewRecorder()
	handler.DeleteGlobalSetting(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestDeleteGlobalSettingMissingKey(t *testing.T) {
	mock := &mockSDK{}
	handler := NewSettingsHandler(mock.Config())
	req := httptest.NewRequest(http.MethodDelete, "/settings/global", nil)
	w := httptest.NewRecorder()
	handler.DeleteGlobalSetting(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
