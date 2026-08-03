package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
)

func TestListProviders(t *testing.T) {
	app := newTestApp(&mockGateway{
		listProvidersFn: func(_ context.Context, _ string, _, _ uint32) ([]*datamodelv1.Provider, error) {
			return []*datamodelv1.Provider{
				{
					Metadata:    &datamodelv1.ObjectMeta{Name: "claude-prov"},
					Type:        "claude",
					Credentials: map[string]string{"api_key": "secret"},
					Config:      map[string]string{"region": "us"},
				},
			}, nil
		},
	})
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/providers", app.ListProviders)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body []map[string]any
	json.NewDecoder(w.Body).Decode(&body)
	if len(body) != 1 {
		t.Fatalf("got %d providers, want 1", len(body))
	}
	// Credentials should be stripped — only names appear
	raw, _ := json.Marshal(body[0])
	if strings.Contains(string(raw), "secret") {
		t.Errorf("response leaked credential value: %s", raw)
	}
	creds := body[0]["credentialNames"].([]any)
	if len(creds) != 1 || creds[0] != "api_key" {
		t.Errorf("credentialNames = %v, want [api_key]", creds)
	}
}

func TestCreateProvider(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "success",
			body:       `{"name":"my-provider","type":"claude","credentials":{"api_key":"sk-123"}}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "missing name",
			body:       `{"name":"","type":"claude"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_provider",
		},
		{
			name:       "missing type",
			body:       `{"name":"my-provider","type":""}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_provider",
		},
		{
			name:       "malformed JSON",
			body:       `{bad}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_body",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockGateway{
				createProviderFn: func(_ context.Context, _ string, prov *datamodelv1.Provider) (*datamodelv1.Provider, error) {
					return prov, nil
				},
			}
			app := newTestApp(mock)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/providers", app.CreateProvider)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/providers", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				json.NewDecoder(w.Body).Decode(&errResp)
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestGetProvider(t *testing.T) {
	tests := []struct {
		name       string
		mockFn     func(ctx context.Context, workspace, name string) (*datamodelv1.Provider, error)
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, _, name string) (*datamodelv1.Provider, error) {
				return &datamodelv1.Provider{
					Metadata: &datamodelv1.ObjectMeta{Name: name},
					Type:     "claude",
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _ string) (*datamodelv1.Provider, error) {
				return nil, status.Error(codes.NotFound, "provider not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getProviderFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/providers/{name}", app.GetProvider)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/providers/claude-prov", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestUpdateProvider(t *testing.T) {
	mock := &mockGateway{
		getProviderFn: func(_ context.Context, _, _ string) (*datamodelv1.Provider, error) {
			return &datamodelv1.Provider{
				Metadata: &datamodelv1.ObjectMeta{Name: "claude-prov"},
				Type:     "claude",
				Config:   map[string]string{"region": "us"},
			}, nil
		},
		updateProviderFn: func(_ context.Context, _ string, prov *datamodelv1.Provider, _ map[string]int64) (*datamodelv1.Provider, error) {
			return prov, nil
		},
	}
	app := newTestApp(mock)
	r := chi.NewRouter()
	r.Put("/workspaces/{workspace}/providers/{name}", app.UpdateProvider)

	body := `{"config":{"region":"eu"}}`
	req := httptest.NewRequest(http.MethodPut, "/workspaces/default/providers/claude-prov", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteProvider(t *testing.T) {
	app := newTestApp(&mockGateway{
		deleteProviderFn: func(_ context.Context, _, _ string) (bool, error) {
			return true, nil
		},
	})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/providers/{name}", app.DeleteProvider)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/providers/claude-prov", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}
