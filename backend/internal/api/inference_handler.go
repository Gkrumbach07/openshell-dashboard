package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

// GetInferenceRoute fetches the workspace inference route. ?route=sandbox-system
// targets the system route; default is the user-facing inference.local route.
func (app *App) GetInferenceRoute(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetInferenceRoute(r.Context(), chi.URLParam(r, "workspace"), r.URL.Query().Get("route"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromInferenceRoute(resp))
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
	resp, err := app.gateway.SetInferenceRoute(r.Context(), chi.URLParam(r, "workspace"), body.RouteName, body.ProviderName, body.ModelID, body.TimeoutSecs, body.NoVerify)
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.InferenceRoute{
		RouteName:    resp.GetRouteName(),
		ProviderName: resp.GetProviderName(),
		ModelID:      resp.GetModelId(),
		Version:      resp.GetVersion(),
		TimeoutSecs:  resp.GetTimeoutSecs(),
	})
}

// DeleteInferenceRoute removes the workspace inference route.
func (app *App) DeleteInferenceRoute(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.DeleteInferenceRoute(r.Context(), chi.URLParam(r, "workspace"), r.URL.Query().Get("route"))
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": resp.GetDeleted()})
}
