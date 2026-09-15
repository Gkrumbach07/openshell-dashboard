package handlers

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type GatewayHandler struct {
	svc        services.GatewayServiceInterface
	auth       *auth.Middleware
	authConfig models.AuthConfigResponse
}

func NewGatewayHandler(svc services.GatewayServiceInterface, authMiddleware *auth.Middleware, authConfig models.AuthConfigResponse) *GatewayHandler {
	return &GatewayHandler{svc: svc, auth: authMiddleware, authConfig: authConfig}
}

// GetGateway returns gateway status, version, and compute drivers.
func (h *GatewayHandler) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc.GetGatewayInfo(r.Context())
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, info)
}

// GetReadyz checks gateway reachability for readiness probes.
func (h *GatewayHandler) GetReadyz(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.CheckHealth(r.Context()); err != nil {
		apiutils.WriteError(w, http.StatusServiceUnavailable, apiutils.NotReady, "gateway unreachable")
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// GetWhoAmI returns gateway identity, falling back to proxy identity.
func (h *GatewayHandler) GetWhoAmI(w http.ResponseWriter, r *http.Request) {
	if h.auth.Disabled() {
		apiutils.WriteJSON(w, http.StatusOK, models.CurrentUser{
			Subject:     "dev-user",
			DisplayName: "Development User",
			Roles:       []string{h.authConfig.AdminRole},
		})
		return
	}

	user, err := h.svc.GetCurrentUser(r.Context())
	if err == nil {
		apiutils.WriteJSON(w, http.StatusOK, user)
		return
	}

	if proxyUser := auth.UserFromContext(r.Context()); proxyUser != "" {
		apiutils.WriteJSON(w, http.StatusOK, models.CurrentUser{Subject: proxyUser, DisplayName: proxyUser})
		return
	}

	apiutils.WriteSDKError(w, err)
}
