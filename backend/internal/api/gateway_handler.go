package api

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetHealthz reports BFF liveness without touching the gateway.
func (app *App) GetHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetGateway returns gateway status, version, and compute drivers.
func (app *App) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := app.gateway.GetGatewayInfo(r.Context())
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromGatewayInfo(info))
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

// AuthConfigResponse tells the frontend whether auth is enabled and which
// features are available.
type AuthConfigResponse struct {
	AdminRole    string       `json:"adminRole,omitempty"`
	LogoutURL    string       `json:"logoutUrl,omitempty"`
	Features     FeatureFlags `json:"features"`
	AuthDisabled bool         `json:"authDisabled"`
}

// GetReadyz checks gateway reachability — used by orchestrators for readiness probes.
func (app *App) GetReadyz(w http.ResponseWriter, r *http.Request) {
	_, err := app.gateway.Health(r.Context())
	if err != nil {
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

	resp, err := app.gateway.GetCurrentUser(r.Context())
	if err == nil {
		writeJSON(w, http.StatusOK, models.FromCurrentUser(resp))
		return
	}

	user := auth.UserFromContext(r.Context())
	if user != "" {
		writeJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     user,
			DisplayName: user,
		})
		return
	}

	writeGrpcError(w, err)
}
