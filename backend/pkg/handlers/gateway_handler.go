// package handlers
//
// import (
// 	"net/http"
//
// 	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
// 	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
// )
//
// // GetGateway returns gateway status, version, and compute drivers.
// func (app *App) GetGateway(w http.ResponseWriter, r *http.Request) {
// 	info, err := h.svc.Health().GetGatewayInfo(r.Context())
// 	if err != nil {
// apiutils.WriteSDKError(w, err)
// 		return
// 	}
// 	writeJSON(w, http.StatusOK, models.FromSDKGatewayInfo(info))
// }
//
// // GetReadyz checks gateway reachability for readiness probes.
// func (app *App) GetReadyz(w http.ResponseWriter, r *http.Request) {
// 	if _, err := h.svc.Health().Check(r.Context()); err != nil {
// 		writeError(w, http.StatusServiceUnavailable, "not_ready", "gateway unreachable")
// 		return
// 	}
// 	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
// }
//
// // GetWhoAmI returns gateway identity, falling back to proxy identity.
// func (app *App) GetWhoAmI(w http.ResponseWriter, r *http.Request) {
// 	if app.auth.Disabled() {
// 		writeJSON(w, http.StatusOK, models.CurrentUser{
// 			Subject:     "dev-user",
// 			DisplayName: "Development User",
// 			Roles:       []string{app.authConfig.AdminRole},
// 		})
// 		return
// 	}
//
// 	user, err := h.svc.Health().GetCurrentUser(r.Context())
// 	if err == nil {
// 		writeJSON(w, http.StatusOK, models.FromSDKCurrentUser(user))
// 		return
// 	}
//
// 	if proxyUser := auth.UserFromContext(r.Context()); proxyUser != "" {
// 		writeJSON(w, http.StatusOK, models.CurrentUser{Subject: proxyUser, DisplayName: proxyUser})
// 		return
// 	}
//
// apiutils.WriteSDKError(w, err)
// }
