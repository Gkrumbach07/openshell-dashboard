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

func TestListServices(t *testing.T) {
	sdk := &mockSDK{}
	sdk.services.listFn = func(_ context.Context, _, _ string, _ ...openshell.ListOptions) ([]*openshell.ServiceEndpoint, error) {
		return []*openshell.ServiceEndpoint{
			{SandboxName: "my-sandbox", ServiceName: "web", TargetPort: 8080, URL: "https://web.example"},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/sandboxes/{name}/services", app.ListServices)
	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/sandboxes/my-sandbox/services", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body []map[string]any
	_ = json.NewDecoder(w.Body).Decode(&body)
	if len(body) != 1 || body[0]["serviceName"] != "web" {
		t.Errorf("body = %v", body)
	}
}

func TestExposeService(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "success", body: `{"service":"web","targetPort":8080}`, wantStatus: http.StatusCreated},
		{name: "missing service", body: `{"service":"","targetPort":8080}`, wantStatus: http.StatusBadRequest},
		{name: "zero port", body: `{"service":"web","targetPort":0}`, wantStatus: http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithSDK(&mockSDK{})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/sandboxes/{name}/services", app.ExposeService)
			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/sandboxes/my-sandbox/services", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteService(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/sandboxes/{name}/services/{svc}", app.DeleteService)
	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/sandboxes/my-sandbox/services/web", nil)
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
