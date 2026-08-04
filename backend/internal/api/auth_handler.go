package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var oidcHTTPClient = &http.Client{Timeout: 10 * time.Second}

const (
	maxTokenResponseBytes = 1 << 20 // 1 MB
	oidcDiscoveryPath     = "/.well-known/openid-configuration"
)

type oidcDiscovery struct {
	TokenEndpoint      string `json:"token_endpoint"`
	EndSessionEndpoint string `json:"end_session_endpoint"`
}

func discoverOIDCEndpoints(issuerURL string) (tokenEndpoint, endSessionEndpoint string, err error) {
	discoveryURL := strings.TrimSuffix(issuerURL, "/") + oidcDiscoveryPath
	resp, err := oidcHTTPClient.Get(discoveryURL)
	if err != nil {
		return "", "", fmt.Errorf("OIDC discovery fetch: %w", err)
	}
	defer resp.Body.Close()

	var disc oidcDiscovery
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxTokenResponseBytes)).Decode(&disc); err != nil {
		return "", "", fmt.Errorf("OIDC discovery parse: %w", err)
	}
	return disc.TokenEndpoint, disc.EndSessionEndpoint, nil
}

// TokenExchangeRequest is the body from the frontend's PKCE callback.
type TokenExchangeRequest struct {
	Code         string `json:"code"`
	RedirectURI  string `json:"redirectUri"`
	CodeVerifier string `json:"codeVerifier"`
}

// TokenExchangeResponse returns tokens to the frontend.
type TokenExchangeResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
}

// RefreshRequest carries the refresh token from the frontend.
type RefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

// oidcTokenResponse is the subset of the IdP token response we parse.
type oidcTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
}

// base64url-encoded '{"' prefix of a JWT header
const jwtHeaderPrefix = "eyJ"

// selectBearer picks the best token for gateway auth: prefer id_token when
// it's a JWT (carries claims for RBAC), fall back to access_token.
func selectBearer(tokens oidcTokenResponse) string {
	if tokens.IDToken != "" && strings.HasPrefix(tokens.IDToken, jwtHeaderPrefix) {
		return tokens.IDToken
	}
	return tokens.AccessToken
}

// TokenExchange proxies the OIDC authorization-code-for-token exchange to the
// IdP's token endpoint server-side, avoiding CORS issues when the browser
// calls the IdP directly.
func (app *App) TokenExchange(w http.ResponseWriter, r *http.Request) {
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		writeError(w, http.StatusBadRequest, "not_configured", "OIDC is not configured")
		return
	}

	var body TokenExchangeRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Code == "" || body.RedirectURI == "" || body.CodeVerifier == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "code, redirectUri, and codeVerifier are required")
		return
	}

	// Discover the token endpoint
	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", "identity provider is unreachable")
		return
	}

	// Exchange the code for tokens
	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {app.authConfig.ClientID},
		"code":          {body.Code},
		"redirect_uri":  {body.RedirectURI},
		"code_verifier": {body.CodeVerifier},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "token request failed")
		return
	}
	defer tokenResp.Body.Close()

	tokenBody, err := io.ReadAll(io.LimitReader(tokenResp.Body, maxTokenResponseBytes))
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "failed to read token response")
		return
	}

	if tokenResp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "identity provider rejected the token exchange")
		return
	}

	var tokens oidcTokenResponse
	if err := json.Unmarshal(tokenBody, &tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "failed to parse token response")
		return
	}

	bearer := selectBearer(tokens)
	if bearer == "" {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "no token in response")
		return
	}

	writeJSON(w, http.StatusOK, TokenExchangeResponse{
		AccessToken:  bearer,
		RefreshToken: tokens.RefreshToken,
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

	postLogoutRedirect := r.URL.Query().Get("redirect")
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

// Refresh exchanges a refresh token for a new access token via the IdP.
func (app *App) Refresh(w http.ResponseWriter, r *http.Request) {
	if app.authConfig.Issuer == "" || app.authConfig.ClientID == "" {
		writeError(w, http.StatusBadRequest, "not_configured", "OIDC is not configured")
		return
	}

	var body RefreshRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "refreshToken is required")
		return
	}

	tokenEndpoint, _, err := discoverOIDCEndpoints(app.authConfig.Issuer)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", "identity provider is unreachable")
		return
	}

	tokenResp, err := oidcHTTPClient.PostForm(tokenEndpoint, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {app.authConfig.ClientID},
		"refresh_token": {body.RefreshToken},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "refresh request failed")
		return
	}
	defer tokenResp.Body.Close()

	tokenBody, err := io.ReadAll(io.LimitReader(tokenResp.Body, maxTokenResponseBytes))
	if err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "failed to read refresh response")
		return
	}

	if tokenResp.StatusCode != http.StatusOK {
		writeError(w, http.StatusUnauthorized, "refresh_failed", "refresh token is invalid or expired")
		return
	}

	var tokens oidcTokenResponse
	if err := json.Unmarshal(tokenBody, &tokens); err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "failed to parse refresh response")
		return
	}

	bearer := selectBearer(tokens)
	if bearer == "" {
		writeError(w, http.StatusBadGateway, "refresh_failed", "no token in refresh response")
		return
	}

	writeJSON(w, http.StatusOK, TokenExchangeResponse{
		AccessToken:  bearer,
		RefreshToken: tokens.RefreshToken,
	})
}
