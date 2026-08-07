package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

// makeJWT builds an unsigned JWT with the given exp claim, for expiry parsing.
func makeJWT(exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload := base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, `{"exp":%d}`, exp))
	return header + "." + payload + ".sig"
}

func TestSessionExpiryPrefersIDTokenExp(t *testing.T) {
	// ID token expires in 60s; expires_in claims 3600 (the access token's).
	// The session must track the ID token (the forwarded bearer), not 3600.
	idExp := time.Now().Add(60 * time.Second).Unix()
	tr := &tokenResponse{IDToken: makeJWT(idExp), ExpiresIn: "3600"}
	s := tr.session()
	if s.ExpiresAt != idExp {
		t.Fatalf("ExpiresAt = %d, want ID token exp %d (not access-token expires_in)", s.ExpiresAt, idExp)
	}
}

func TestSessionExpiryTakesEarlierOfIDExpAndExpiresIn(t *testing.T) {
	// ID token valid for an hour, but expires_in says the access token dies in
	// 30s. When the ID token is the bearer we key off its exp; verify we never
	// overrun a shorter access-token window either.
	idExp := time.Now().Add(1 * time.Hour).Unix()
	tr := &tokenResponse{IDToken: makeJWT(idExp), ExpiresIn: "30"}
	s := tr.session()
	accessExpiry := time.Now().Add(30 * time.Second).Unix()
	if s.ExpiresAt > accessExpiry+2 {
		t.Fatalf("ExpiresAt = %d, want <= access expiry %d", s.ExpiresAt, accessExpiry)
	}
}

func TestSessionExpiryToleratesStringExpiresIn(t *testing.T) {
	// Azure AD v1.0 renders expires_in as a JSON string; the decode must not
	// choke. Round-trip through JSON to exercise the json.Number path.
	var tr tokenResponse
	if err := json.Unmarshal([]byte(`{"access_token":"opaque","expires_in":"3599"}`), &tr); err != nil {
		t.Fatalf("decode with string expires_in: %v", err)
	}
	s := tr.session()
	if s.ExpiresAt == 0 {
		t.Fatal("ExpiresAt = 0, want it set from a string expires_in")
	}
}

func TestTokenExchangeSurfacesOAuthError(t *testing.T) {
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_, _ = fmt.Fprintf(w, `{"token_endpoint":%q}`, issuer.URL+"/token")
		case "/token":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"code expired"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(issuer.Close)

	app := &App{sessions: newTestSessionCodec(t), authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}
	body := `{"code":"stale","codeVerifier":"v","redirectUri":"https://d/cb"}`
	w := httptest.NewRecorder()
	app.TokenExchange(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (not a 401 login loop)", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_grant") || !strings.Contains(w.Body.String(), "code expired") {
		t.Fatalf("body = %s, want the OAuth error surfaced", w.Body.String())
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

func TestSessionManagerEnforcesAbsoluteLifetime(t *testing.T) {
	codec := newTestSessionCodec(t)
	// Refresh would succeed, but the session is past its absolute ceiling.
	issuer := newFakeIssuer(t, `{"id_token":"refreshed","refresh_token":"r","expires_in":300}`)
	app := &App{sessions: codec, authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}
	sm := &sessionManager{codec: codec, app: app}

	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{
		Token:        "stale",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Unix() - 60,
		CreatedAt:    time.Now().Add(-13 * time.Hour).Unix(),
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
		t.Fatalf("token = %q, want empty — session past absolute lifetime must end", token)
	}
	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("over-age session cookie not cleared: %#v", cookie)
	}
}

func TestSessionManagerRefreshPreservesCreatedAt(t *testing.T) {
	issuer := newFakeIssuer(t, `{"id_token":"refreshed-id-token","refresh_token":"rotated","expires_in":300}`)
	codec := newTestSessionCodec(t)
	app := &App{sessions: codec, authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}
	sm := &sessionManager{codec: codec, app: app}

	created := time.Now().Add(-2 * time.Hour).Unix()
	seed := httptest.NewRecorder()
	if err := codec.SetSession(seed, &auth.Session{
		Token:        "stale",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Unix() - 60,
		CreatedAt:    created,
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
	sm.TokenFromSession(w, req)
	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil {
		t.Fatal("no refreshed cookie")
	}
	readReq := httptest.NewRequest(http.MethodGet, "/", nil)
	readReq.AddCookie(cookie)
	session, err := codec.LoadSession(readReq)
	if err != nil || session == nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if session.CreatedAt != created {
		t.Fatalf("CreatedAt = %d, want %d preserved across refresh", session.CreatedAt, created)
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
	app.Logout(w, httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil))

	cookie := findCookie(w.Result().Cookies(), auth.SessionCookieName)
	if cookie == nil || cookie.MaxAge != -1 {
		t.Fatalf("clear session cookie = %#v, want MaxAge -1", cookie)
	}
}

func TestLogoutReturnsEndSessionRedirect(t *testing.T) {
	issuer := newFakeIssuer(t, `{}`)
	app := &App{authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}

	w := httptest.NewRecorder()
	app.Logout(w, httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), issuer.URL+"/logout") {
		t.Fatalf("body = %s, want end-session URL", w.Body.String())
	}
}

func TestLogoutRedirectUsesRequestOriginNotReferer(t *testing.T) {
	issuer := newFakeIssuer(t, `{}`)
	app := &App{authConfig: AuthConfigResponse{Issuer: issuer.URL, ClientID: "dashboard"}}

	req := httptest.NewRequest(http.MethodPost, "https://dashboard.example.com/api/v1/auth/logout", nil)
	req.Host = "dashboard.example.com"
	req.Header.Set("Referer", "https://evil.example.com/attack")
	w := httptest.NewRecorder()
	app.Logout(w, req)

	body := w.Body.String()
	if strings.Contains(body, "evil.example.com") {
		t.Fatalf("logout redirect honored attacker Referer: %s", body)
	}
	if !strings.Contains(body, url.QueryEscape("https://dashboard.example.com/login")) {
		t.Fatalf("logout redirect should point at the request origin's /login: %s", body)
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
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
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
