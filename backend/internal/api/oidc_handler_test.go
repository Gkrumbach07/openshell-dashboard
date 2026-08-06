package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

func TestOIDCTokenHandlersSetTerminalCookie(t *testing.T) {
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_, _ = fmt.Fprintf(w, `{"token_endpoint":%q}`, issuer.URL+"/token")
		case "/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id_token":"signed-id-token","refresh_token":"refresh-token"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer issuer.Close()

	app := &App{authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}
	tests := []struct {
		handler http.HandlerFunc
		name    string
		body    string
	}{
		{
			name:    "token exchange",
			body:    `{"code":"code","codeVerifier":"verifier","redirectUri":"https://dashboard.example.com/auth/callback"}`,
			handler: app.TokenExchange,
		},
		{
			name:    "refresh",
			body:    `{"refreshToken":"refresh-token"}`,
			handler: app.Refresh,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			w := httptest.NewRecorder()
			tc.handler(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
			}
			cookie := findCookie(w.Result().Cookies(), auth.TerminalTokenCookieName)
			if cookie == nil || cookie.Value != "signed-id-token" {
				t.Fatalf("terminal token cookie = %#v, want signed-id-token", cookie)
			}
		})
	}
}

func TestLogoutClearsTerminalCookie(t *testing.T) {
	app := &App{}
	w := httptest.NewRecorder()
	app.Logout(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil))

	cookie := findCookie(w.Result().Cookies(), auth.TerminalTokenCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("clear terminal token cookie = %#v, want MaxAge -1", cookie)
	}
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}
