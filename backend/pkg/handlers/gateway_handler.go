package handlers

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type GatewayHandler struct {
	svc        services.GatewayServiceInterface
	auth       auth.MiddlewareInterface
	authConfig models.AuthConfigResponse
	// support is the gateway range this build supports. The zero value means
	// none was configured, and every gateway is then reported as "unknown".
	support models.GatewaySupport
}

func NewGatewayHandler(svc services.GatewayServiceInterface, authMiddleware auth.MiddlewareInterface, authConfig models.AuthConfigResponse) *GatewayHandler {
	return &GatewayHandler{svc: svc, auth: authMiddleware, authConfig: authConfig}
}

// SetGatewaySupport declares the gateway range this build supports, which
// GetGateway compares the gateway's reported version against. It is a setter
// rather than a NewGatewayHandler parameter so that existing callers of the
// constructor keep compiling. Call it before the handler serves requests.
func (h *GatewayHandler) SetGatewaySupport(support models.GatewaySupport) {
	h.support = support
}

// GetGateway returns gateway status, version, and compute drivers, plus the
// dashboard's own verdict on whether that version is one it supports.
//
// The verdict only informs. A gateway outside the range is still served in
// full — the BFF relays and never blocks (ADR 0002) — so the UI can explain
// the errors a mismatched gateway produces instead of leaving them unexplained.
func (h *GatewayHandler) GetGateway(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc.GetGatewayInfo(r.Context())
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	if info == nil {
		apiutils.WriteJSON(w, http.StatusOK, info)
		return
	}
	// Judged here rather than in the service so the verdict survives a
	// downstream replacing GatewayServiceInterface. Copy first: the service
	// owns the value it returned.
	out := *info
	compatibility := h.support.Check(info.GatewayVersion)
	out.Compatibility = &compatibility
	apiutils.WriteJSON(w, http.StatusOK, out)
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
