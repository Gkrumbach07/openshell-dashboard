package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

// oidcHTTPClient talks to the IdP. The timeout bounds discovery and token
// calls so a hanging or slow IdP cannot pin goroutines indefinitely.
var oidcHTTPClient = &http.Client{Timeout: 15 * time.Second}

type discoveryDoc struct {
	tokenEndpoint      string
	endSessionEndpoint string
	fetchedAt          time.Time
}

// discoveryTTL caches the discovery document so token exchange and refresh
// don't re-fetch it on every call — which matters because refresh happens
// under a lock, and a per-call round trip would lengthen the hold.
const discoveryTTL = 15 * time.Minute

var (
	discoveryMu    sync.Mutex
	discoveryCache = map[string]discoveryDoc{}
)

func discoverOIDCEndpoints(issuer string) (tokenEndpoint, endSessionEndpoint string, err error) {
	discoveryMu.Lock()
	if cached, ok := discoveryCache[issuer]; ok && time.Since(cached.fetchedAt) < discoveryTTL {
		discoveryMu.Unlock()
		return cached.tokenEndpoint, cached.endSessionEndpoint, nil
	}
	discoveryMu.Unlock()

	discoveryURL := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	resp, err := oidcHTTPClient.Get(discoveryURL)
	if err != nil {
		return "", "", fmt.Errorf("identity provider is unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("discovery returned status %d", resp.StatusCode)
	}
	var discovery struct {
		TokenEndpoint      string `json:"token_endpoint"`
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&discovery); err != nil {
		return "", "", fmt.Errorf("failed to parse discovery document: %w", err)
	}
	if discovery.TokenEndpoint == "" {
		return "", "", fmt.Errorf("discovery document has no token_endpoint")
	}

	discoveryMu.Lock()
	discoveryCache[issuer] = discoveryDoc{
		tokenEndpoint:      discovery.TokenEndpoint,
		endSessionEndpoint: discovery.EndSessionEndpoint,
		fetchedAt:          time.Now(),
	}
	discoveryMu.Unlock()

	return discovery.TokenEndpoint, discovery.EndSessionEndpoint, nil
}

// GetOIDCDiscovery proxies the OIDC discovery document from the issuer,
// avoiding CORS issues when the frontend and IdP are on different origins.
func (app *App) GetOIDCDiscovery(w http.ResponseWriter, _ *http.Request) {
	if app.authConfig.Issuer == "" {
		writeError(w, http.StatusServiceUnavailable, "no_issuer", "OIDC issuer not configured")
		return
	}
	issuer := strings.TrimRight(app.authConfig.Issuer, "/")
	resp, err := oidcHTTPClient.Get(issuer + "/.well-known/openid-configuration")
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", "identity provider is unreachable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "discovery_failed", "identity provider returned an error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

// tokenResponse is the subset of the IdP token endpoint response we use.
// ExpiresIn is json.Number so a provider that renders it as a JSON string
// (older Azure AD v1.0, non-strict OAuth servers) doesn't fail the decode.
type tokenResponse struct {
	AccessToken  string      `json:"access_token"`
	IDToken      string      `json:"id_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    json.Number `json:"expires_in"`
}

// session builds the server-side session from an IdP token response. The ID
// token is preferred as the gateway bearer (it carries the sub/groups claims
// the gateway's RBAC reads); the access token is the fallback.
func (t *tokenResponse) session() *auth.Session {
	bearer := t.IDToken
	if bearer == "" {
		bearer = t.AccessToken
	}
	now := time.Now().Unix()
	s := &auth.Session{Token: bearer, RefreshToken: t.RefreshToken, CreatedAt: now}

	// Expiry must track the *forwarded bearer*, not whichever token expires_in
	// happened to describe. expires_in per RFC 6749 is the access token's
	// lifetime; when we forward the ID token (which can expire much sooner or
	// later — Okta pins ID tokens to 60m), scheduling refresh off expires_in
	// leaves the session "live" after the ID token is dead, so the gateway
	// 401s and never triggers a refresh. Prefer the bearer's own `exp` claim.
	if exp := jwtExpiry(bearer); exp > 0 {
		s.ExpiresAt = exp
	}
	if secs, err := t.ExpiresIn.Int64(); err == nil && secs > 0 {
		accessExpiry := now + secs
		// Take the earlier of the two so we never overrun the live bearer.
		if s.ExpiresAt == 0 || accessExpiry < s.ExpiresAt {
			s.ExpiresAt = accessExpiry
		}
	}
	return s
}

// jwtExpiry reads the `exp` claim (unix seconds) from a JWT's payload without
// verifying the signature. This is NOT token validation — the gateway remains
// the sole authority on token validity; the BFF reads exp only to schedule
// its own refresh. Returns 0 for a non-JWT (opaque) token or a missing claim.
func jwtExpiry(token string) int64 {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return 0
	}
	return claims.Exp
}

// TokenExchange swaps an authorization code for tokens via the IdP's token
// endpoint, then seals them into the encrypted session cookie. Tokens are
// never returned to the browser — the cookie is the session.
func (app *App) TokenExchange(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		writeError(w, http.StatusBadRequest, "not_configured", "OIDC is not configured")
		return
	}
	if app.sessions == nil {
		writeError(w, http.StatusInternalServerError, "no_session_codec", "session support is not configured")
		return
	}

	var body struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		RedirectURI  string `json:"redirectUri"`
	}
	// decodeBody bounds the body (MaxBytesReader) and rejects unknown fields —
	// this is a public, unauthenticated endpoint.
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "code is required")
		return
	}

	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		slog.Warn("OIDC discovery failed", "error", err)
		writeError(w, http.StatusBadGateway, "discovery_failed", "identity provider is unreachable")
		return
	}

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {app.authConfig.ClientID},
		"code":          {body.Code},
		"redirect_uri":  {body.RedirectURI},
		"code_verifier": {body.CodeVerifier},
	}
	if app.oidcClientSecret != "" {
		form.Set("client_secret", app.oidcClientSecret)
	}
	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, form)
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "identity provider is unreachable")
		return
	}
	defer tokenResp.Body.Close()

	// A non-2xx from the token endpoint is an OAuth error (invalid_grant,
	// invalid_client, redirect_uri_mismatch, …). Surface it as a 400 with the
	// provider's error/description instead of a flat 401 — a 401 would send
	// the frontend into a login loop that can't succeed on a misconfiguration.
	if tokenResp.StatusCode != http.StatusOK {
		var oauthErr struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.NewDecoder(io.LimitReader(tokenResp.Body, 1<<16)).Decode(&oauthErr)
		slog.Warn("token exchange rejected", "status", tokenResp.StatusCode, "error", oauthErr.Error, "description", oauthErr.Description)
		msg := "identity provider rejected the sign-in"
		if oauthErr.Error != "" {
			msg = oauthErr.Error
			if oauthErr.Description != "" {
				msg += ": " + oauthErr.Description
			}
		}
		writeError(w, http.StatusBadRequest, "token_exchange_rejected", msg)
		return
	}

	var tokens tokenResponse
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_parse_failed", "failed to parse token response")
		return
	}
	if tokens.AccessToken == "" && tokens.IDToken == "" {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "no token received from identity provider")
		return
	}

	if err := app.sessions.SetSession(w, tokens.session()); err != nil {
		writeError(w, http.StatusInternalServerError, "session_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

// refreshSession exchanges a refresh token for new tokens server-side. Called
// by the session manager when a session's bearer has expired.
func (app *App) refreshSession(refreshToken string) (*auth.Session, error) {
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		return nil, fmt.Errorf("OIDC is not configured")
	}

	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		return nil, err
	}

	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {app.authConfig.ClientID},
		"refresh_token": {refreshToken},
	}
	if app.oidcClientSecret != "" {
		form.Set("client_secret", app.oidcClientSecret)
	}
	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, form)
	if err != nil {
		return nil, fmt.Errorf("identity provider is unreachable: %w", err)
	}
	defer tokenResp.Body.Close()

	if tokenResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("identity provider rejected the refresh (status %d)", tokenResp.StatusCode)
	}

	var tokens tokenResponse
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}
	if tokens.AccessToken == "" && tokens.IDToken == "" {
		return nil, fmt.Errorf("no token received from identity provider")
	}

	session := tokens.session()
	if session.RefreshToken == "" {
		// IdP did not rotate the refresh token; keep using the old one.
		session.RefreshToken = refreshToken
	}
	return session, nil
}

// requestOrigin returns the BFF's own scheme://host for this request, honoring
// the standard reverse-proxy forwarding header for the scheme.
func requestOrigin(r *http.Request) string {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		if fwd := r.Header.Get("X-Forwarded-Proto"); fwd != "" {
			scheme = fwd
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + r.Host
}

// GetSession reports whether the request carries a valid session. It sits
// behind the auth middleware, so reaching it at all means the request
// authenticated (header, cookie, or dev mode). The frontend uses this as its
// login probe — unlike whoami it never calls the gateway, so an unreachable
// gateway doesn't log the user out.
func (app *App) GetSession(w http.ResponseWriter, _ *http.Request) {
	noStore(w)
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

// Logout clears the session cookie and returns the OIDC end-session URL so
// the frontend can redirect the browser to the IdP to clear the SSO session.
func (app *App) Logout(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	// Capture the session's ID token before clearing: RP-Initiated Logout
	// expects id_token_hint alongside post_logout_redirect_uri, and some OPs
	// show a confirmation page or reject the redirect without it.
	var idTokenHint string
	if app.sessions != nil {
		if session, err := app.sessions.LoadSession(r); err == nil && session != nil {
			idTokenHint = session.Token
		}
	}
	auth.ClearSession(w)
	if app.authConfig.Issuer == "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": "/login"})
		return
	}

	_, endSessionEndpoint, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil || endSessionEndpoint == "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": "/login"})
		return
	}

	// Build an absolute post-logout URI from the BFF's own origin. OPs
	// validate this against registered values and often reject relative URIs,
	// so it must be absolute — and it must not come from a client-supplied
	// header (Referer), which an attacker could steer.
	params := url.Values{
		"client_id":                {app.authConfig.ClientID},
		"post_logout_redirect_uri": {requestOrigin(r) + "/login"},
	}
	if idTokenHint != "" {
		params.Set("id_token_hint", idTokenHint)
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"redirect": endSessionEndpoint + "?" + params.Encode(),
	})
}
