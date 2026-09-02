package handlers

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services/gateway"
)

type GatewayHandler struct {
	*Handler
	gateway gateway.ServiceInterface
}

func NewGatewayHandler(svc gateway.ServiceInterface) *GatewayHandler {
	return &GatewayHandler{
		gateway: svc,
	}
}

// GetGateway returns gateway status, version, and compute drivers.
func (h *GatewayHandler) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := h.gateway.GetHealth().GetGatewayInfo(r.Context())
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKGatewayInfo(info))
}

// GetReadyz checks gateway reachability — used by orchestrators for readiness probes.
func (h *GatewayHandler) GetReadyz(w http.ResponseWriter, r *http.Request) {
	if _, err := h.gateway.CheckHealth(r.Context()); err != nil {
		apiutils.WriteError(w, http.StatusServiceUnavailable, apiutils.NotReady, "gateway unreachable")
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// GetWhoAmI returns the current user's identity from the gateway. Falls back to
// the username from the auth proxy header when the gateway doesn't support
// GetCurrentUser or when auth is disabled.
func (h *GatewayHandler) GetWhoAmI(w http.ResponseWriter, r *http.Request) {
	if app.auth.Disabled() {
		// The dev user's roles must include the *configured* admin role —
		// hardcoding gateway-default role names here made admin pages
		// silently inaccessible whenever ADMIN_ROLE differed.
		apiutils.WriteJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     "dev-user",
			DisplayName: "Development User",
			Roles:       []string{app.authConfig.AdminRole},
		})
		return
	}

	user, err := h.sdk.Health().GetCurrentUser(r.Context())
	if err == nil {
		apiutils.WriteJSON(w, http.StatusOK, models.FromSDKCurrentUser(user))
		return
	}

	proxyUser := auth.UserFromContext(r.Context())
	if proxyUser != "" {
		apiutils.WriteJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     proxyUser,
			DisplayName: proxyUser,
		})
		return
	}

	writeSDKError(w, err)
}
