package api

import (
	"net/http"

	openshell "github.com/rhuss/openshell-sdk-go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/models"
)

func (app *App) GetGlobalSettings(w http.ResponseWriter, r *http.Request) {
	config, err := app.client.Config().GetGateway(r.Context())
	if err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.FromGatewaySettings(config))
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
	if _, err := app.client.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
		SettingKey:   body.Key,
		SettingValue: &openshell.SettingValue{Type: openshell.SettingValueString, StringVal: body.Value},
		Global:       true,
	}); err != nil {
		writeSDKError(w, err)
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
	if _, err := app.client.Config().Update(r.Context(), "", &openshell.ConfigUpdate{
		SettingKey:    key,
		DeleteSetting: true,
		Global:        true,
	}); err != nil {
		writeSDKError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
