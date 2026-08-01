package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

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

// TokenExchange proxies the OIDC authorization-code-for-token exchange to the
// IdP's token endpoint server-side, avoiding CORS issues when the browser
// calls the IdP directly.
func (app *App) TokenExchange(w http.ResponseWriter, r *http.Request) {
	if authConfig.Issuer == "" || authConfig.ClientID == "" {
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
	discoveryURL := strings.TrimSuffix(authConfig.Issuer, "/") + "/.well-known/openid-configuration"
	discoveryResp, err := http.Get(discoveryURL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", fmt.Sprintf("OIDC discovery failed: %v", err))
		return
	}
	defer discoveryResp.Body.Close()

	var discovery struct {
		TokenEndpoint string `json:"token_endpoint"`
	}
	if err := json.NewDecoder(discoveryResp.Body).Decode(&discovery); err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", "failed to parse OIDC discovery")
		return
	}

	// Exchange the code for tokens
	tokenResp, err := http.PostForm(discovery.TokenEndpoint, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {authConfig.ClientID},
		"code":          {body.Code},
		"redirect_uri":  {body.RedirectURI},
		"code_verifier": {body.CodeVerifier},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", fmt.Sprintf("token request failed: %v", err))
		return
	}
	defer tokenResp.Body.Close()

	tokenBody, err := io.ReadAll(tokenResp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "failed to read token response")
		return
	}

	if tokenResp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "token_exchange_failed",
			fmt.Sprintf("IdP returned %d: %s", tokenResp.StatusCode, string(tokenBody)))
		return
	}

	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
	}
	if err := json.Unmarshal(tokenBody, &tokens); err != nil {
		writeError(w, http.StatusBadGateway, "token_exchange_failed", "failed to parse token response")
		return
	}

	// Use id_token when it's a JWT (contains claims for gateway RBAC).
	// Fall back to access_token for providers that use opaque id_tokens.
	bearer := tokens.AccessToken
	if tokens.IDToken != "" && strings.HasPrefix(tokens.IDToken, "eyJ") {
		bearer = tokens.IDToken
	}
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
	if authConfig.Issuer == "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": "/login"})
		return
	}

	discoveryURL := strings.TrimSuffix(authConfig.Issuer, "/") + "/.well-known/openid-configuration"
	discoveryResp, err := http.Get(discoveryURL)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": "/login"})
		return
	}
	defer discoveryResp.Body.Close()

	var discovery struct {
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	if err := json.NewDecoder(discoveryResp.Body).Decode(&discovery); err != nil || discovery.EndSessionEndpoint == "" {
		writeJSON(w, http.StatusOK, map[string]string{"redirect": "/login"})
		return
	}

	postLogoutRedirect := r.URL.Query().Get("redirect")
	if postLogoutRedirect == "" {
		postLogoutRedirect = "/login"
	}

	logoutURL := fmt.Sprintf("%s?client_id=%s&post_logout_redirect_uri=%s",
		discovery.EndSessionEndpoint,
		url.QueryEscape(authConfig.ClientID),
		url.QueryEscape(postLogoutRedirect),
	)

	writeJSON(w, http.StatusOK, map[string]string{"redirect": logoutURL})
}

// Refresh exchanges a refresh token for a new access token via the IdP.
func (app *App) Refresh(w http.ResponseWriter, r *http.Request) {
	if authConfig.Issuer == "" || authConfig.ClientID == "" {
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

	discoveryURL := strings.TrimSuffix(authConfig.Issuer, "/") + "/.well-known/openid-configuration"
	discoveryResp, err := http.Get(discoveryURL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", fmt.Sprintf("OIDC discovery failed: %v", err))
		return
	}
	defer discoveryResp.Body.Close()

	var discovery struct {
		TokenEndpoint string `json:"token_endpoint"`
	}
	if err := json.NewDecoder(discoveryResp.Body).Decode(&discovery); err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", "failed to parse OIDC discovery")
		return
	}

	tokenResp, err := http.PostForm(discovery.TokenEndpoint, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {authConfig.ClientID},
		"refresh_token": {body.RefreshToken},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", fmt.Sprintf("refresh request failed: %v", err))
		return
	}
	defer tokenResp.Body.Close()

	tokenBody, err := io.ReadAll(tokenResp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "failed to read refresh response")
		return
	}

	if tokenResp.StatusCode != http.StatusOK {
		writeError(w, http.StatusUnauthorized, "refresh_failed", "refresh token is invalid or expired")
		return
	}

	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(tokenBody, &tokens); err != nil {
		writeError(w, http.StatusBadGateway, "refresh_failed", "failed to parse refresh response")
		return
	}

	writeJSON(w, http.StatusOK, TokenExchangeResponse{
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	})
}
