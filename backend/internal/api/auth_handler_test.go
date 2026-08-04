package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetAuthConfig(t *testing.T) {
	app := &App{
		authConfig: AuthConfigResponse{
			Issuer:   "https://keycloak.example.com/realms/openshell",
			ClientID: "dashboard",
			Scopes:   "openid profile email",
			Features: FeatureFlags{
				Terminal:     true,
				FileTransfer: true,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil)
	w := httptest.NewRecorder()
	app.GetAuthConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["issuer"] != "https://keycloak.example.com/realms/openshell" {
		t.Errorf("issuer = %v", body["issuer"])
	}
	if body["clientId"] != "dashboard" {
		t.Errorf("clientId = %v", body["clientId"])
	}
	if body["scopes"] != "openid profile email" {
		t.Errorf("scopes = %v", body["scopes"])
	}
	features, ok := body["features"].(map[string]any)
	if !ok {
		t.Fatal("features is not a map")
	}
	if features["terminal"] != true {
		t.Errorf("terminal = %v", features["terminal"])
	}
}

func TestGetAuthConfigDisabled(t *testing.T) {
	app := &App{
		authConfig: AuthConfigResponse{
			AuthDisabled: true,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/config", nil)
	w := httptest.NewRecorder()
	app.GetAuthConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["authDisabled"] != true {
		t.Errorf("authDisabled = %v", body["authDisabled"])
	}
}

func TestTokenExchangeMissingCode(t *testing.T) {
	app := &App{
		authConfig: AuthConfigResponse{
			Issuer:   "https://keycloak.example.com/realms/openshell",
			ClientID: "dashboard",
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/token-exchange",
		strings.NewReader(`{"redirectUri":"http://localhost:3000","codeVerifier":"v"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.TokenExchange(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if errResp.Code != "invalid_request" {
		t.Errorf("code = %q, want invalid_request", errResp.Code)
	}
}

func TestTokenExchangeNotConfigured(t *testing.T) {
	app := &App{authConfig: AuthConfigResponse{}}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/token-exchange",
		strings.NewReader(`{"code":"abc","redirectUri":"http://localhost","codeVerifier":"v"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.TokenExchange(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if errResp.Code != "not_configured" {
		t.Errorf("code = %q, want not_configured", errResp.Code)
	}
}

func TestTokenExchangeSuccess(t *testing.T) {
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			tokenURL := fmt.Sprintf("http://%s/token", r.Host)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"token_endpoint":%q,"end_session_endpoint":""}`, tokenURL)
		case "/token":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"access_token":"at-123","id_token":"eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig","refresh_token":"rt-456"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer idp.Close()

	app := &App{
		authConfig: AuthConfigResponse{
			Issuer:   idp.URL,
			ClientID: "dashboard",
		},
	}

	body := `{"code":"auth-code-123","redirectUri":"http://localhost:3000/callback","codeVerifier":"pkce-verifier"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/token-exchange", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.TokenExchange(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	var resp TokenExchangeResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.HasPrefix(resp.AccessToken, "eyJ") {
		t.Errorf("expected JWT id_token as bearer, got %q", resp.AccessToken)
	}
	if resp.RefreshToken != "rt-456" {
		t.Errorf("refreshToken = %q, want rt-456", resp.RefreshToken)
	}
}

func TestSelectBearer(t *testing.T) {
	tests := []struct {
		name   string
		tokens oidcTokenResponse
		want   string
	}{
		{
			name:   "prefers id_token when JWT",
			tokens: oidcTokenResponse{AccessToken: "at", IDToken: "eyJhbGciOiJSUzI1NiJ9.body.sig"},
			want:   "eyJhbGciOiJSUzI1NiJ9.body.sig",
		},
		{
			name:   "falls back to access_token when no id_token",
			tokens: oidcTokenResponse{AccessToken: "opaque-at"},
			want:   "opaque-at",
		},
		{
			name:   "falls back to access_token when id_token not JWT",
			tokens: oidcTokenResponse{AccessToken: "opaque-at", IDToken: "not-a-jwt"},
			want:   "opaque-at",
		},
		{
			name:   "empty tokens",
			tokens: oidcTokenResponse{},
			want:   "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := selectBearer(tc.tokens)
			if got != tc.want {
				t.Errorf("selectBearer = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLogoutWithIssuer(t *testing.T) {
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"token_endpoint":"http://%s/token","end_session_endpoint":"http://%s/logout"}`, r.Host, r.Host)
	}))
	defer idp.Close()

	app := &App{
		authConfig: AuthConfigResponse{
			Issuer:   idp.URL,
			ClientID: "dashboard",
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout?redirect=http://localhost:3000", nil)
	w := httptest.NewRecorder()
	app.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(body["redirect"], "/logout") {
		t.Errorf("redirect = %q, expected logout URL", body["redirect"])
	}
	if !strings.Contains(body["redirect"], "client_id=dashboard") {
		t.Errorf("redirect missing client_id: %q", body["redirect"])
	}
}

func TestLogoutWithoutIssuer(t *testing.T) {
	app := &App{authConfig: AuthConfigResponse{}}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil)
	w := httptest.NewRecorder()
	app.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["redirect"] != "/login" {
		t.Errorf("redirect = %q, want /login", body["redirect"])
	}
}

func TestRefreshNotConfigured(t *testing.T) {
	app := &App{authConfig: AuthConfigResponse{}}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh",
		strings.NewReader(`{"refreshToken":"rt-123"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.Refresh(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestRefreshMissingToken(t *testing.T) {
	app := &App{
		authConfig: AuthConfigResponse{
			Issuer:   "https://example.com",
			ClientID: "dashboard",
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.Refresh(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if errResp.Code != "invalid_request" {
		t.Errorf("code = %q, want invalid_request", errResp.Code)
	}
}
