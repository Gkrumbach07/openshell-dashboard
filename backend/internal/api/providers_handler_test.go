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
	grpcstatus "google.golang.org/grpc/status"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
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
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("got %d providers, want 1", len(body))
	}
	// Credentials should be stripped — only names appear
	raw, _ := json.Marshal(body[0])
	if strings.Contains(string(raw), "secret") {
		t.Errorf("response leaked credential value: %s", raw)
	}
	creds, ok := body[0]["credentialNames"].([]any)
	if !ok {
		t.Fatal("credentialNames is not an array")
	}
	if len(creds) != 1 || creds[0] != "api_key" {
		t.Errorf("credentialNames = %v, want [api_key]", creds)
	}
}

func TestCreateProvider(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
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
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode error response: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestGetProvider(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, workspace, name string) (*datamodelv1.Provider, error)
		name       string
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
				return nil, grpcstatus.Error(codes.NotFound, "provider not found")
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

func TestGetProviderProfile(t *testing.T) {
	tests := []struct {
		mockFn     func(ctx context.Context, id, workspace string) (*openshellv1.ProviderProfile, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			mockFn: func(_ context.Context, id, _ string) (*openshellv1.ProviderProfile, error) {
				return &openshellv1.ProviderProfile{
					Id:          id,
					DisplayName: "Claude",
					Category:    openshellv1.ProviderProfileCategory_PROVIDER_PROFILE_CATEGORY_INFERENCE,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			mockFn: func(_ context.Context, _, _ string) (*openshellv1.ProviderProfile, error) {
				return nil, grpcstatus.Error(codes.NotFound, "profile not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(&mockGateway{getProviderProfileFn: tc.mockFn})
			r := chi.NewRouter()
			r.Get("/workspaces/{workspace}/provider-profiles/{profileId}", app.GetProviderProfile)

			req := httptest.NewRequest(http.MethodGet, "/workspaces/default/provider-profiles/claude", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
		})
	}
}

func TestImportProviderProfiles(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"profiles":[{"id":"custom-llm","displayName":"Custom LLM","category":"INFERENCE","inferenceCapable":true,"credentials":[{"name":"api_key","required":true}]}]}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "empty profiles",
			body:       `{"profiles":[]}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_request",
		},
		{
			name:       "missing id",
			body:       `{"profiles":[{"id":"","displayName":"No ID","category":"OTHER"}]}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_profile",
		},
		{
			name:       "missing displayName",
			body:       `{"profiles":[{"id":"test","displayName":"","category":"OTHER"}]}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_profile",
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
				importProviderProfilesFn: func(_ context.Context, _ string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.ImportProviderProfilesResponse, error) {
					result := make([]*openshellv1.ProviderProfile, 0, len(profiles))
					for _, item := range profiles {
						result = append(result, item.Profile)
					}
					return &openshellv1.ImportProviderProfilesResponse{
						Profiles: result,
						Imported: true,
					}, nil
				},
			}
			app := newTestApp(mock)
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/provider-profiles", app.ImportProviderProfiles)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/provider-profiles", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode error response: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestImportProviderProfilesResponse(t *testing.T) {
	mock := &mockGateway{
		importProviderProfilesFn: func(_ context.Context, _ string, profiles []*openshellv1.ProviderProfileImportItem) (*openshellv1.ImportProviderProfilesResponse, error) {
			return &openshellv1.ImportProviderProfilesResponse{
				Profiles: []*openshellv1.ProviderProfile{profiles[0].Profile},
				Imported: true,
				Diagnostics: []*openshellv1.ProviderProfileDiagnostic{
					{ProfileId: "custom-llm", Field: "credentials", Message: "consider adding env_vars", Severity: "warning"},
				},
			}, nil
		},
	}
	app := newTestApp(mock)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/provider-profiles", app.ImportProviderProfiles)

	body := `{"profiles":[{"id":"custom-llm","displayName":"Custom LLM","category":"INFERENCE","inferenceCapable":false}]}`
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/provider-profiles", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["imported"] != true {
		t.Errorf("imported = %v, want true", resp["imported"])
	}
	profiles, ok := resp["profiles"].([]any)
	if !ok || len(profiles) != 1 {
		t.Fatalf("profiles length = %d, want 1", len(profiles))
	}
	diagnostics, ok := resp["diagnostics"].([]any)
	if !ok || len(diagnostics) != 1 {
		t.Fatalf("diagnostics length = %d, want 1", len(diagnostics))
	}
}

func TestUpdateProviderProfile(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "success",
			body:       `{"profile":{"id":"custom-llm","displayName":"Updated LLM","category":"INFERENCE","inferenceCapable":true},"expectedResourceVersion":1}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "id mismatch",
			body:       `{"profile":{"id":"wrong-id","displayName":"Mismatch","category":"OTHER","inferenceCapable":false}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "id_mismatch",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockGateway{
				updateProviderProfileFn: func(_ context.Context, _, _ string, item *openshellv1.ProviderProfileImportItem, _ uint64) (*openshellv1.UpdateProviderProfilesResponse, error) {
					return &openshellv1.UpdateProviderProfilesResponse{
						Profile: item.Profile,
						Updated: true,
					}, nil
				},
			}
			app := newTestApp(mock)
			r := chi.NewRouter()
			r.Put("/workspaces/{workspace}/provider-profiles/{profileId}", app.UpdateProviderProfile)

			req := httptest.NewRequest(http.MethodPut, "/workspaces/default/provider-profiles/custom-llm", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body: %s", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantCode != "" {
				var errResp ErrorResponse
				if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode error response: %v", err)
				}
				if errResp.Code != tc.wantCode {
					t.Errorf("code = %q, want %q", errResp.Code, tc.wantCode)
				}
			}
		})
	}
}

func TestDeleteProviderProfile(t *testing.T) {
	app := newTestApp(&mockGateway{
		deleteProviderProfileFn: func(_ context.Context, _, _ string) (bool, error) {
			return true, nil
		},
	})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/provider-profiles/{profileId}", app.DeleteProviderProfile)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/provider-profiles/custom-llm", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["deleted"] != true {
		t.Errorf("deleted = %v, want true", resp["deleted"])
	}
}

func TestLintProviderProfiles(t *testing.T) {
	mock := &mockGateway{
		lintProviderProfilesFn: func(_ context.Context, _ string, _ []*openshellv1.ProviderProfileImportItem) (*openshellv1.LintProviderProfilesResponse, error) {
			return &openshellv1.LintProviderProfilesResponse{
				Valid: true,
			}, nil
		},
	}
	app := newTestApp(mock)
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/provider-profiles/lint", app.LintProviderProfiles)

	body := `{"profiles":[{"id":"test","displayName":"Test","category":"OTHER","inferenceCapable":false}]}`
	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/provider-profiles/lint", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["valid"] != true {
		t.Errorf("valid = %v, want true", resp["valid"])
	}
}
