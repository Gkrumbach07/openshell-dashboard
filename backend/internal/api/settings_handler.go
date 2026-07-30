package api

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

func (app *App) GetGlobalSettings(w http.ResponseWriter, r *http.Request) {
	resp, err := app.gateway.GetGatewaySettings(r.Context())
	if err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromGatewaySettings(resp))
}

type SetSettingRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (app *App) SetGlobalSetting(w http.ResponseWriter, r *http.Request) {
	var body SetSettingRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Key == "" {
		writeError(w, http.StatusBadRequest, "invalid_setting", "key is required")
		return
	}
	if err := app.gateway.SetSetting(r.Context(), body.Key, body.Value); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (app *App) DeleteGlobalSetting(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "invalid_setting", "key query parameter is required")
		return
	}
	if err := app.gateway.DeleteSetting(r.Context(), key); err != nil {
		writeGrpcError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
