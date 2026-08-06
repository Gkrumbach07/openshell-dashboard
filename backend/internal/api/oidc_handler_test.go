package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

func newTestSessionCodec(t *testing.T) *auth.SessionCodec {
	t.Helper()
	codec, err := auth.NewSessionCodec([]byte("test-secret"))
	if err != nil {
		t.Fatalf("NewSessionCodec: %v", err)
	}
	return codec
}

// newFakeIssuer serves an OIDC discovery document and token endpoint.
func newFakeIssuer(t *testing.T, tokenJSON string) *httptest.Server {
	t.Helper()
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_, _ = fmt.Fprintf(w, `{"token_endpoint":%q,"end_session_endpoint":%q}`,
				issuer.URL+"/token", issuer.URL+"/logout")
		case "/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(tokenJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(issuer.Close)
	return issuer
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func TestTokenExchangeSetsSessionCookie(t *testing.T) {
	issuer := newFakeIssuer(t, `{"id_token":"signed-id-token","refresh_token":"refresh-token","expires_in":300}`)
	codec := newTestSessionCodec(t)
	app := &App{
		sessions:   codec,
		authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"},
	}

	body := `{"code":"code","codeVerifier":"verifier","redirectUri":"https://dashboard.example.com/auth/callback"}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	w := httptest.NewRecorder()
	app.TokenExchange(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "signed-id-token") {
		t.Fatal("token leaked into the response body — tokens must live only in the cookie")
	}

	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil {
		t.Fatal("no session cookie set")
	}
	readReq := httptest.NewRequest(http.MethodGet, "/", nil)
	readReq.AddCookie(cookie)
	session, err := codec.LoadSession(readReq)
	if err != nil || session == nil {
		t.Fatalf("LoadSession: session=%v err=%v", session, err)
	}
	if session.Token != "signed-id-token" || session.RefreshToken != "refresh-token" {
		t.Fatalf("session = %+v, want id token + refresh token", session)
	}
	if session.ExpiresAt < time.Now().Unix() {
		t.Fatalf("session.ExpiresAt = %d, want future", session.ExpiresAt)
	}
}

func TestRefreshSessionKeepsOldRefreshToken(t *testing.T) {
	// IdP that does not rotate the refresh token on refresh.
	issuer := newFakeIssuer(t, `{"id_token":"new-id-token","expires_in":300}`)
	app := &App{authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}

	session, err := app.refreshSession("old-refresh-token")
	if err != nil {
		t.Fatalf("refreshSession: %v", err)
	}
	if session.Token != "new-id-token" {
		t.Fatalf("token = %q, want new-id-token", session.Token)
	}
	if session.RefreshToken != "old-refresh-token" {
		t.Fatalf("refresh token = %q, want the original preserved", session.RefreshToken)
	}
}

func TestSessionManagerRefreshesExpiredSession(t *testing.T) {
	issuer := newFakeIssuer(t, `{"id_token":"refreshed-id-token","refresh_token":"rotated-refresh","expires_in":300}`)
	codec := newTestSessionCodec(t)
	app := &App{
		sessions:   codec,
		authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"},
	}
	sm := &sessionManager{codec: codec, app: app}

	// Seed a request with an expired session.
	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{
		Token:        "stale-token",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Unix() - 60,
	}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, cookie := range seed.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			req.AddCookie(cookie)
		}
	}

	w := httptest.NewRecorder()
	token := sm.TokenFromSession(w, req)

	if token != "refreshed-id-token" {
		t.Fatalf("token = %q, want refreshed-id-token", token)
	}
	// The refreshed session must be re-set on the response.
	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil {
		t.Fatal("refreshed session cookie not set on response")
	}
	readReq := httptest.NewRequest(http.MethodGet, "/", nil)
	readReq.AddCookie(cookie)
	session, err := codec.LoadSession(readReq)
	if err != nil || session == nil {
		t.Fatalf("LoadSession after refresh: session=%v err=%v", session, err)
	}
	if session.RefreshToken != "rotated-refresh" {
		t.Fatalf("refresh token = %q, want rotated-refresh", session.RefreshToken)
	}
}

func TestSessionManagerParallelRequestsShareOneRefresh(t *testing.T) {
	// An IdP with single-use refresh tokens: the second redemption of the
	// same token fails, as Dex does by default.
	var tokenCalls int
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_, _ = fmt.Fprintf(w, `{"token_endpoint":%q}`, issuer.URL+"/token")
		case "/token":
			tokenCalls++
			if tokenCalls > 1 {
				http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id_token":"refreshed-id-token","refresh_token":"rotated-refresh","expires_in":300}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(issuer.Close)

	codec := newTestSessionCodec(t)
	app := &App{
		sessions:   codec,
		authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"},
	}
	sm := &sessionManager{codec: codec, app: app}

	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{
		Token:        "stale-token",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Unix() - 60,
	}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}

	// Two requests from the same page load, both carrying the old cookie.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		for _, cookie := range seed.Result().Cookies() {
			if cookie.MaxAge >= 0 {
				req.AddCookie(cookie)
			}
		}
		w := httptest.NewRecorder()
		if token := sm.TokenFromSession(w, req); token != "refreshed-id-token" {
			t.Fatalf("request %d: token = %q, want refreshed-id-token", i+1, token)
		}
	}
	if tokenCalls != 1 {
		t.Fatalf("IdP token endpoint called %d times, want 1 (single-flight)", tokenCalls)
	}
}

func TestSessionManagerExpiredWithoutRefreshEndsSession(t *testing.T) {
	codec := newTestSessionCodec(t)
	sm := &sessionManager{codec: codec, app: &App{sessions: codec}}

	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{
		Token:     "stale-token",
		ExpiresAt: time.Now().Unix() - 60,
	}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, cookie := range seed.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			req.AddCookie(cookie)
		}
	}

	w := httptest.NewRecorder()
	if token := sm.TokenFromSession(w, req); token != "" {
		t.Fatalf("token = %q, want empty — an unrenewable expired session must end", token)
	}
	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("expired session cookie not cleared: %#v", cookie)
	}
}

func TestSessionManagerGarbageCookieCleared(t *testing.T) {
	codec := newTestSessionCodec(t)
	sm := &sessionManager{codec: codec, app: &App{sessions: codec}}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "not-a-session"})
	w := httptest.NewRecorder()

	if token := sm.TokenFromSession(w, req); token != "" {
		t.Fatalf("token = %q, want empty for garbage cookie", token)
	}
	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("garbage session cookie not cleared: %#v", cookie)
	}
}

func TestLogoutClearsSessionCookie(t *testing.T) {
	app := &App{}
	w := httptest.NewRecorder()
	app.Logout(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil))

	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("clear session cookie = %#v, want MaxAge -1", cookie)
	}
}

func TestLogoutReturnsEndSessionRedirect(t *testing.T) {
	issuer := newFakeIssuer(t, `{}`)
	app := &App{authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}

	w := httptest.NewRecorder()
	app.Logout(w, httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), issuer.URL+"/logout") {
		t.Fatalf("body = %s, want end-session URL", w.Body.String())
	}
}

func TestLogoutIncludesIDTokenHint(t *testing.T) {
	issuer := newFakeIssuer(t, `{}`)
	codec := newTestSessionCodec(t)
	app := &App{
		sessions:   codec,
		authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"},
	}

	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{Token: "the-id-token"}); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil)
	for _, cookie := range seed.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			req.AddCookie(cookie)
		}
	}

	w := httptest.NewRecorder()
	app.Logout(w, req)

	if !strings.Contains(w.Body.String(), "id_token_hint=the-id-token") {
		t.Fatalf("body = %s, want id_token_hint per RP-Initiated Logout", w.Body.String())
	}
}

func TestTokenEndpointCallsIncludeClientSecret(t *testing.T) {
	var gotSecret string
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_, _ = fmt.Fprintf(w, `{"token_endpoint":%q}`, issuer.URL+"/token")
		case "/token":
			_ = r.ParseForm()
			gotSecret = r.PostFormValue("client_secret")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id_token":"signed-id-token","expires_in":300}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(issuer.Close)

	app := &App{
		sessions:         newTestSessionCodec(t),
		authConfig:       AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"},
		oidcClientSecret: "confidential-secret",
	}

	body := `{"code":"code","codeVerifier":"verifier","redirectUri":"https://dashboard.example.com/auth/callback"}`
	w := httptest.NewRecorder()
	app.TokenExchange(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	if gotSecret != "confidential-secret" {
		t.Fatalf("token exchange client_secret = %q, want confidential-secret", gotSecret)
	}

	gotSecret = ""
	if _, err := app.refreshSession("refresh-token"); err != nil {
		t.Fatalf("refreshSession: %v", err)
	}
	if gotSecret != "confidential-secret" {
		t.Fatalf("refresh client_secret = %q, want confidential-secret", gotSecret)
	}
}
