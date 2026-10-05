package handlers

import (
	"context"
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
// GetGateway and GetGatewayCompatibility compare the gateway's reported
// version against. It is a setter rather than a NewGatewayHandler parameter so
// that existing callers of the constructor keep compiling. Call it before the
// handler serves requests.
func (h *GatewayHandler) SetGatewaySupport(support models.GatewaySupport) {
	h.support = support
}

// GetGateway returns gateway status, version, and compute drivers, plus the
// dashboard's own verdict on whether that version is one it supports.
//
// The verdict only informs. A gateway outside the range is still served in
// full — the BFF relays and never blocks (ADR 0002) — so the UI can explain
// the errors a mismatched gateway produces instead of leaving them unexplained.
//
// A gateway that enforces roles answers GetGatewayInfo only for platform
// admins, so there this route is a 403 for everyone else.
// GetGatewayCompatibility is where a caller without that role gets the
// verdict.
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

// GetGatewayCompatibility returns the gateway's version and the dashboard's
// verdict on it to any signed-in caller.
//
// A gateway that is too old breaks every user's pages, not only an admin's,
// so the explanation must not depend on a role. The version itself is not
// privileged: the gateway's health check hands it to anyone, without a token.
// This route therefore reads the version from the health check instead of
// from GetGatewayInfo, and makes no authorization decision of its own.
//
// Like GetGateway it only informs. A gateway that cannot be reached is relayed
// as the error it is, never dressed up as a verdict.
func (h *GatewayHandler) GetGatewayCompatibility(w http.ResponseWriter, r *http.Request) {
	version, err := h.gatewayVersion(r.Context())
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.GatewayCompatibilityInfo{
		GatewayVersion: version,
		Compatibility:  h.support.Check(version),
	})
}

// gatewayVersion reads the gateway's version the way the fewest callers are
// refused: through the health check when the service offers it, and through
// GetGatewayInfo — admins only — when a downstream service does not.
func (h *GatewayHandler) gatewayVersion(ctx context.Context) (string, error) {
	if reader, ok := h.svc.(services.GatewayVersionReader); ok {
		return reader.GetGatewayVersion(ctx)
	}
	info, err := h.svc.GetGatewayInfo(ctx)
	if err != nil {
		return "", err
	}
	if info == nil {
		return "", nil
	}
	return info.GatewayVersion, nil
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
