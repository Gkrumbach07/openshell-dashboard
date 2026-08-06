package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
)

// oidcHTTPClient talks to the IdP. The timeout bounds discovery and token
// calls so a hanging or slow IdP cannot pin goroutines indefinitely.
var oidcHTTPClient = &http.Client{Timeout: 15 * time.Second}

func discoverOIDCEndpoints(issuer string) (tokenEndpoint, endSessionEndpoint string, err error) {
	discoveryURL := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	resp, err := oidcHTTPClient.Get(discoveryURL)
	if err != nil {
		return "", "", fmt.Errorf("identity provider is unreachable: %w", err)
	}
	defer resp.Body.Close()
	var discovery struct {
		TokenEndpoint      string `json:"token_endpoint"`
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&discovery); err != nil {
		return "", "", fmt.Errorf("failed to parse discovery document: %w", err)
	}
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
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// session builds the server-side session from an IdP token response. The ID
// token is preferred as the gateway bearer (it carries the sub/groups claims
// the gateway's RBAC reads); the access token is the fallback.
func (t *tokenResponse) session() *auth.Session {
	bearer := t.IDToken
	if bearer == "" {
		bearer = t.AccessToken
	}
	s := &auth.Session{Token: bearer, RefreshToken: t.RefreshToken}
	if t.ExpiresIn > 0 {
		s.ExpiresAt = time.Now().Unix() + t.ExpiresIn
	}
	return s
}

// TokenExchange swaps an authorization code for tokens via the IdP's token
// endpoint, then seals them into the encrypted session cookie. Tokens are
// never returned to the browser — the cookie is the session.
func (app *App) TokenExchange(w http.ResponseWriter, r *http.Request) {
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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "code is required")
		return
	}

	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", err.Error())
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

	var tokens tokenResponse
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_parse_failed", "failed to parse token response")
		return
	}
	if tokens.AccessToken == "" && tokens.IDToken == "" {
		writeError(w, http.StatusUnauthorized, "token_exchange_failed", "no token received from identity provider")
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

// GetSession reports whether the request carries a valid session. It sits
// behind the auth middleware, so reaching it at all means the request
// authenticated (header, cookie, or dev mode). The frontend uses this as its
// login probe — unlike whoami it never calls the gateway, so an unreachable
// gateway doesn't log the user out.
func (app *App) GetSession(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

// Logout clears the session cookie and returns the OIDC end-session URL so
// the frontend can redirect the browser to the IdP to clear the SSO session.
func (app *App) Logout(w http.ResponseWriter, r *http.Request) {
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

	postLogoutRedirect := r.Header.Get("Referer")
	if postLogoutRedirect == "" {
		postLogoutRedirect = "/login"
	}

	params := url.Values{
		"client_id":                {app.authConfig.ClientID},
		"post_logout_redirect_uri": {postLogoutRedirect},
	}
	if idTokenHint != "" {
		params.Set("id_token_hint", idTokenHint)
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"redirect": endSessionEndpoint + "?" + params.Encode(),
	})
}
