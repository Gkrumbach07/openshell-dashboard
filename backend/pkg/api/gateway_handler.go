package api

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
)

// GetHealthz reports BFF liveness without touching the gateway.
func (app *App) GetHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetGateway returns gateway status, version, and compute drivers.
func (app *App) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := app.sdk.Health().GetGatewayInfo(r.Context())
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKGatewayInfo(info))
}

// FeatureFlags controls which optional features the frontend should render.
type FeatureFlags struct {
	Terminal          bool `json:"terminal"`
	FileTransfer      bool `json:"fileTransfer"`
	Settings          bool `json:"settings"`
	GlobalPolicy      bool `json:"globalPolicy"`
	CredentialRefresh bool `json:"credentialRefresh"`
	Services          bool `json:"services"`
	DraftPolicy       bool `json:"draftPolicy"`
}

// AuthConfigResponse tells the frontend whether auth is enabled, which features
// are available, and — for embedding hosts — which identity domain this gateway
// trusts.
//
// The OIDC fields are public client metadata, not a credential: issuer, client id
// and audience are exactly what any browser-based client sends in an authorization
// request. Publishing them is not auth termination, token validation, or
// authorization, so ADR 0002 still holds — the BFF still never runs a flow.
//
// They exist because a host embedding this dashboard (for example RHOAI, which
// renders the npm package against several gateways) has to know where to send the
// user to sign in, per gateway, before any token exists. Sourcing that from the
// component co-deployed with the gateway keeps it closer to the gateway's own
// --oidc-issuer/--oidc-audience than copying it into every embedding host.
type AuthConfigResponse struct {
	AdminRole string `json:"adminRole,omitempty"`
	LogoutURL string `json:"logoutUrl,omitempty"`
	// Issuer is the OIDC provider this gateway's JWKS validation trusts.
	Issuer string `json:"issuer,omitempty"`
	// ClientID is the public (PKCE) client a browser should authenticate with.
	ClientID string `json:"clientId,omitempty"`
	// Audience is the resource audience the minted token must carry for the
	// gateway to accept it. A mismatch here surfaces only as a gateway refusal.
	Audience string `json:"audience,omitempty"`
	// Scope is the space-separated scope string for the authorization request.
	Scope string `json:"scope,omitempty"`
	// APIVersion is this dashboard's release, so an embedding host can detect
	// skew between the npm package it bundles and the image it talks to.
	APIVersion   string       `json:"apiVersion,omitempty"`
	Features     FeatureFlags `json:"features"`
	AuthDisabled bool         `json:"authDisabled"`
}

// GetReadyz checks gateway reachability — used by orchestrators for readiness probes.
func (app *App) GetReadyz(w http.ResponseWriter, r *http.Request) {
	if _, err := app.sdk.Health().Check(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "not_ready", "gateway unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// GetAuthConfig is public — the frontend needs it before any auth exists.
func (app *App) GetAuthConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, app.authConfig)
}

// GetWhoAmI returns the current user's identity from the gateway. Falls back to
// the username from the auth proxy header when the gateway doesn't support
// GetCurrentUser or when auth is disabled.
func (app *App) GetWhoAmI(w http.ResponseWriter, r *http.Request) {
	if app.auth.Disabled() {
		// The dev user's roles must include the *configured* admin role —
		// hardcoding gateway-default role names here made admin pages
		// silently inaccessible whenever ADMIN_ROLE differed.
		writeJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     "dev-user",
			DisplayName: "Development User",
			Roles:       []string{app.authConfig.AdminRole},
		})
		return
	}

	user, err := app.sdk.Health().GetCurrentUser(r.Context())
	if err == nil {
		writeJSON(w, http.StatusOK, models.FromSDKCurrentUser(user))
		return
	}

	proxyUser := auth.UserFromContext(r.Context())
	if proxyUser != "" {
		writeJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     proxyUser,
			DisplayName: proxyUser,
		})
		return
	}

	writeSDKError(w, err)
}
