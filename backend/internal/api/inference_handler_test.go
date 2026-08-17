package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

func TestGetInferenceRoute(t *testing.T) {
	sdk := &mockSDK{}
	sdk.inference.getFn = func(_ context.Context, _, routeName string) (*openshell.InferenceRoute, error) {
		return &openshell.InferenceRoute{
			RouteName:    routeName,
			ProviderName: "claude",
			ModelID:      "claude-3",
			Version:      7,
			TimeoutSecs:  60,
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/inference", app.GetInferenceRoute)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/inference", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["providerName"] != "claude" || body["modelId"] != "claude-3" {
		t.Errorf("body = %v", body)
	}
}

func TestSetInferenceRoute(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "success", body: `{"providerName":"claude","modelId":"claude-3"}`, wantStatus: http.StatusOK},
		{name: "missing fields", body: `{"providerName":"claude"}`, wantStatus: http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithSDK(&mockSDK{})
			r := chi.NewRouter()
			r.Put("/workspaces/{workspace}/inference", app.SetInferenceRoute)
			req := httptest.NewRequest(http.MethodPut, "/workspaces/default/inference", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteInferenceRoute(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/inference", app.DeleteInferenceRoute)
	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/inference", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]bool
	_ = json.NewDecoder(w.Body).Decode(&body)
	if !body["deleted"] {
		t.Errorf("deleted = %v", body["deleted"])
	}
}
