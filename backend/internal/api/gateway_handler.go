package api

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetHealthz reports BFF liveness without touching the gateway.
func (app *App) GetHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetGateway returns gateway status, version, and compute drivers — the
// complete set of gateway self-description the API offers.
func (app *App) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := app.gateway.GetGatewayInfo(r.Context())
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromGatewayInfo(info))
}

// FeatureFlags controls which optional features the frontend should render.
// Parsed from FEATURE_* env vars in main.go.
type FeatureFlags struct {
	Terminal          bool   `json:"terminal"`
	FileTransfer      bool   `json:"fileTransfer"`
	Settings          bool   `json:"settings"`
	GlobalPolicy      bool   `json:"globalPolicy"`
	CredentialRefresh bool   `json:"credentialRefresh"`
	Services          bool   `json:"services"`
	DraftPolicy       bool   `json:"draftPolicy"`
	DeploymentContext string `json:"deploymentContext"`
	WorkspaceBinding  bool   `json:"workspaceBinding"`
	ResourceLinks     bool   `json:"resourceLinks"`
}

// AuthConfigResponse tells the frontend how to authenticate and which
// features are enabled.
type AuthConfigResponse struct {
	AuthDisabled bool         `json:"authDisabled"`
	Issuer       string       `json:"issuer,omitempty"`
	ClientID     string       `json:"clientId,omitempty"`
	AdminRole    string       `json:"adminRole,omitempty"`
	UserRole     string       `json:"userRole,omitempty"`
	Features     FeatureFlags `json:"features"`
}

var authConfig AuthConfigResponse

// SetAuthConfig stores the values served by GET /api/v1/auth/config.
func SetAuthConfig(cfg AuthConfigResponse) {
	authConfig = cfg
}

// GetAuthConfig is public — the login page needs it before any token exists.
func (app *App) GetAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, authConfig)
}

// GetOIDCDiscovery proxies the OIDC discovery document from the issuer,
// avoiding CORS issues when the frontend and IdP are on different origins.
func (app *App) GetOIDCDiscovery(w http.ResponseWriter, r *http.Request) {
	if authConfig.Issuer == "" {
		writeError(w, http.StatusServiceUnavailable, "no_issuer", "OIDC issuer not configured")
		return
	}
	issuer := strings.TrimRight(authConfig.Issuer, "/")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(issuer + "/.well-known/openid-configuration")
	if err != nil {
		writeError(w, http.StatusBadGateway, "discovery_failed", err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// GetUserInfo returns the validated OIDC claims for the current user.
func (app *App) GetUserInfo(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "no identity")
		return
	}
	writeJSON(w, http.StatusOK, claims)
}

// GetWhoAmI returns the current user's identity from the gateway. Falls back to
// OIDC token claims when the gateway doesn't support GetCurrentUser (pre-PR#2445)
// or when auth is disabled (dev mode).
func (app *App) GetWhoAmI(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())

	if app.auth.Disabled() {
		writeJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     claims.Subject,
			DisplayName: claims.Name,
			Roles:       []string{"openshell-admin", "openshell-user"},
		})
		return
	}

	resp, err := app.gateway.GetCurrentUser(r.Context())
	if err == nil {
		writeJSON(w, http.StatusOK, models.FromCurrentUser(resp))
		return
	}

	// Fallback: extract identity from the validated OIDC claims directly.
	// This handles gateways that predate GetCurrentUser (PR #2445).
	if claims != nil {
		writeJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     claims.Subject,
			DisplayName: claims.Name,
			Email:       claims.Email,
			Roles:       claims.Roles(),
		})
		return
	}

	writeGrpcError(w, err)
}
