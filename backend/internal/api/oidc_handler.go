package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

var oidcHTTPClient = &http.Client{}

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
	io.Copy(w, resp.Body)
}

// TokenExchange swaps an authorization code for tokens via the IdP's token
// endpoint. The BFF does this server-side so the client secret (if any) and
// the token endpoint URL are never exposed to the browser.
func (app *App) TokenExchange(w http.ResponseWriter, r *http.Request) {
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		writeError(w, http.StatusBadRequest, "not_configured", "OIDC is not configured")
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

	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {app.authConfig.ClientID},
		"code":          {body.Code},
		"redirect_uri":  {body.RedirectURI},
		"code_verifier": {body.CodeVerifier},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "identity provider is unreachable")
		return
	}
	defer tokenResp.Body.Close()

	var tokens struct {
		AccessToken  string `json:"access_token"`
		IDToken      string `json:"id_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_parse_failed", "failed to parse token response")
		return
	}

	if tokens.AccessToken == "" && tokens.IDToken == "" {
		writeError(w, http.StatusUnauthorized, "token_exchange_failed", "no token received from identity provider")
		return
	}

	bearer := tokens.IDToken
	if bearer == "" {
		bearer = tokens.AccessToken
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"accessToken":  bearer,
		"refreshToken": tokens.RefreshToken,
	})
}

// Refresh exchanges a refresh token for a new access token.
func (app *App) Refresh(w http.ResponseWriter, r *http.Request) {
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		writeError(w, http.StatusBadRequest, "not_configured", "OIDC is not configured")
		return
	}

	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "refreshToken is required")
		return
	}

	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", err.Error())
		return
	}

	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {app.authConfig.ClientID},
		"refresh_token": {body.RefreshToken},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "identity provider is unreachable")
		return
	}
	defer tokenResp.Body.Close()

	var tokens struct {
		AccessToken  string `json:"access_token"`
		IDToken      string `json:"id_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_parse_failed", "failed to parse token response")
		return
	}

	bearer := tokens.IDToken
	if bearer == "" {
		bearer = tokens.AccessToken
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"accessToken":  bearer,
		"refreshToken": tokens.RefreshToken,
	})
}

// Logout returns the OIDC end-session URL so the frontend can redirect the
// browser to the IdP to clear the SSO session cookie.
func (app *App) Logout(w http.ResponseWriter, r *http.Request) {
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

	logoutURL := fmt.Sprintf("%s?client_id=%s&post_logout_redirect_uri=%s",
		endSessionEndpoint,
		url.QueryEscape(app.authConfig.ClientID),
		url.QueryEscape(postLogoutRedirect),
	)

	writeJSON(w, http.StatusOK, map[string]string{"redirect": logoutURL})
}
