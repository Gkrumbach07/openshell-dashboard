package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetInferenceRoute fetches the workspace inference route. ?route=sandbox-system
// targets the system route; default is the user-facing inference.local route.
func (app *App) GetInferenceRoute(w http.ResponseWriter, r *http.Request) {
	route, err := app.sdk.Inference().GetRoute(r.Context(), chi.URLParam(r, "workspace"), r.URL.Query().Get("route"))
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKInferenceRoute(route))
}

// SetInferenceRouteRequest configures how inference.local resolves for the
// workspace's sandboxes.
type SetInferenceRouteRequest struct {
	RouteName    string `json:"routeName,omitempty"`
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	TimeoutSecs  uint64 `json:"timeoutSecs,omitempty"`
	NoVerify     bool   `json:"noVerify,omitempty"`
}

// SetInferenceRoute sets the workspace inference route.
func (app *App) SetInferenceRoute(w http.ResponseWriter, r *http.Request) {
	var body SetInferenceRouteRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ProviderName == "" || body.ModelID == "" {
		writeError(w, http.StatusBadRequest, "invalid_route", "providerName and modelId are required")
		return
	}
	route, err := app.sdk.Inference().SetRoute(r.Context(), chi.URLParam(r, "workspace"), &openshell.InferenceRouteConfig{
		RouteName:    body.RouteName,
		ProviderName: body.ProviderName,
		ModelID:      body.ModelID,
		TimeoutSecs:  body.TimeoutSecs,
		NoVerify:     body.NoVerify,
	})
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromSDKInferenceRoute(route))
}

// DeleteInferenceRoute removes the workspace inference route.
func (app *App) DeleteInferenceRoute(w http.ResponseWriter, r *http.Request) {
	if err := app.sdk.Inference().DeleteRoute(r.Context(), chi.URLParam(r, "workspace"), r.URL.Query().Get("route")); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
