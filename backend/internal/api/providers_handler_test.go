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

func TestListProviders(t *testing.T) {
	sdk := &mockSDK{}
	sdk.providers.listFn = func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Provider, error) {
		return []*openshell.Provider{
			{
				Name: "claude-prov",
				Type: "claude",
				Spec: openshell.ProviderSpec{
					Credentials: map[string]string{"api_key": "secret"},
					Config:      map[string]string{"region": "us"},
				},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
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

func TestListProvidersUnavailable(t *testing.T) {
	sdk := &mockSDK{}
	sdk.providers.listFn = func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.Provider, error) {
		return nil, &openshell.StatusError{Code: openshell.ErrorUnavailable, Message: "gateway down"}
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/providers", app.ListProviders)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
}

func TestCreateProvider(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		createFn   func(ctx context.Context, workspace string, provider *openshell.Provider) (*openshell.Provider, error)
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
		{
			name: "already exists",
			body: `{"name":"my-provider","type":"claude"}`,
			createFn: func(_ context.Context, _ string, _ *openshell.Provider) (*openshell.Provider, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorAlreadyExists, Message: "exists"}
			},
			wantStatus: http.StatusConflict,
			wantCode:   "already_exists",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.providers.createFn = tc.createFn
			app := newTestAppWithSDK(sdk)
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
		getFn      func(ctx context.Context, workspace, name string) (*openshell.Provider, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			getFn: func(_ context.Context, _, name string) (*openshell.Provider, error) {
				return &openshell.Provider{Name: name, Type: "claude"}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			getFn: func(_ context.Context, _, _ string) (*openshell.Provider, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "provider not found"}
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.providers.getFn = tc.getFn
			app := newTestAppWithSDK(sdk)
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
	sdk := &mockSDK{}
	sdk.providers.getFn = func(_ context.Context, _, _ string) (*openshell.Provider, error) {
		return &openshell.Provider{
			Name: "claude-prov",
			Type: "claude",
			Spec: openshell.ProviderSpec{Config: map[string]string{"region": "us"}},
		}, nil
	}
	sdk.providers.updateFn = func(_ context.Context, _ string, prov *openshell.Provider) (*openshell.Provider, error) {
		if prov.Spec.Config["region"] != "eu" {
			t.Errorf("merged config region = %q, want eu", prov.Spec.Config["region"])
		}
		return prov, nil
	}
	app := newTestAppWithSDK(sdk)
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
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Delete("/workspaces/{workspace}/providers/{name}", app.DeleteProvider)

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/default/providers/claude-prov", nil)
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

func TestConfigureProviderRefresh(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "success oauth2",
			body:       `{"credentialKey":"api_key","strategy":"oauth2-refresh-token"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "aws sts accepted",
			body:       `{"credentialKey":"role","strategy":"aws-sts-assume-role"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing key",
			body:       `{"credentialKey":"","strategy":"static"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_request",
		},
		{
			name:       "unknown strategy",
			body:       `{"credentialKey":"api_key","strategy":"nope"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_strategy",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithSDK(&mockSDK{})
			r := chi.NewRouter()
			r.Post("/workspaces/{workspace}/providers/{name}/refresh", app.ConfigureProviderRefresh)

			req := httptest.NewRequest(http.MethodPost, "/workspaces/default/providers/claude-prov/refresh", strings.NewReader(tc.body))
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

func TestRotateAndDeleteProviderRefresh(t *testing.T) {
	app := newTestAppWithSDK(&mockSDK{})
	r := chi.NewRouter()
	r.Post("/workspaces/{workspace}/providers/{name}/refresh/rotate", app.RotateProviderCredential)
	r.Delete("/workspaces/{workspace}/providers/{name}/refresh", app.DeleteProviderRefresh)

	req := httptest.NewRequest(http.MethodPost, "/workspaces/default/providers/claude-prov/refresh/rotate", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("rotate missing key status = %d, want 400", w.Code)
	}

	req = httptest.NewRequest(http.MethodDelete, "/workspaces/default/providers/claude-prov/refresh", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("delete missing key status = %d, want 400", w.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/workspaces/default/providers/claude-prov/refresh/rotate", strings.NewReader(`{"credentialKey":"api_key"}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("rotate status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/workspaces/default/providers/claude-prov/refresh?credentialKey=api_key", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("delete status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

func TestGetProviderProfile(t *testing.T) {
	tests := []struct {
		getFn      func(ctx context.Context, workspace, id string) (*openshell.ProviderProfile, error)
		name       string
		wantStatus int
	}{
		{
			name: "success",
			getFn: func(_ context.Context, _, id string) (*openshell.ProviderProfile, error) {
				return &openshell.ProviderProfile{
					ID:          id,
					DisplayName: "Claude",
					Category:    openshell.ProfileCategoryInference,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "not found",
			getFn: func(_ context.Context, _, _ string) (*openshell.ProviderProfile, error) {
				return nil, &openshell.StatusError{Code: openshell.ErrorNotFound, Message: "profile not found"}
			},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sdk := &mockSDK{}
			sdk.providers.profiles.getFn = tc.getFn
			app := newTestAppWithSDK(sdk)
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

func TestGetProviderProfileArgOrder(t *testing.T) {
	sdk := &mockSDK{}
	sdk.providers.profiles.getFn = func(_ context.Context, workspace, id string) (*openshell.ProviderProfile, error) {
		if workspace != "default" || id != "claude" {
			t.Errorf("Get args workspace=%q id=%q, want default/claude", workspace, id)
		}
		return &openshell.ProviderProfile{ID: id, DisplayName: "Claude"}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/provider-profiles/{profileId}", app.GetProviderProfile)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/provider-profiles/claude", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
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
			app := newTestAppWithSDK(&mockSDK{})
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
	sdk := &mockSDK{}
	sdk.providers.profiles.importFn = func(_ context.Context, _ string, items []openshell.ProfileImportItem) (*openshell.ImportResult, error) {
		return &openshell.ImportResult{
			Profiles: []openshell.ProviderProfile{items[0].Profile},
			Imported: true,
			Diagnostics: []openshell.ProfileDiagnostic{
				{ProfileID: "custom-llm", Field: "credentials", Message: "consider adding env_vars", Severity: "warning"},
			},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
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
			app := newTestAppWithSDK(&mockSDK{})
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
	sdk := &mockSDK{}
	sdk.providers.profiles.deleteFn = func(_ context.Context, workspace, id string) (bool, error) {
		if workspace != "default" || id != "custom-llm" {
			t.Errorf("Delete args workspace=%q id=%q, want default/custom-llm", workspace, id)
		}
		return true, nil
	}
	app := newTestAppWithSDK(sdk)
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
	app := newTestAppWithSDK(&mockSDK{})
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

func TestGetProviderRefreshStatus(t *testing.T) {
	sdk := &mockSDK{}
	sdk.providers.refresh.getStatusFn = func(_ context.Context, _, _, _ string) ([]*openshell.RefreshStatus, error) {
		return []*openshell.RefreshStatus{
			{CredentialKey: "api_key", Strategy: openshell.RefreshStrategyStatic, Status: "active"},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/providers/{name}/refresh-status", app.GetProviderRefreshStatus)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/providers/claude-prov/refresh-status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var body []map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 1 || body[0]["credentialKey"] != "api_key" || body[0]["strategy"] != "STATIC" {
		t.Errorf("body = %v", body)
	}
}

func TestListProviderProfiles(t *testing.T) {
	sdk := &mockSDK{}
	sdk.providers.profiles.listFn = func(_ context.Context, _ string, _ ...openshell.ListOptions) ([]*openshell.ProviderProfile, error) {
		return []*openshell.ProviderProfile{
			{ID: "claude", DisplayName: "Claude", Category: openshell.ProfileCategoryInference},
		}, nil
	}
	app := newTestAppWithSDK(sdk)
	r := chi.NewRouter()
	r.Get("/workspaces/{workspace}/provider-profiles", app.ListProviderProfiles)

	req := httptest.NewRequest(http.MethodGet, "/workspaces/default/provider-profiles", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}
