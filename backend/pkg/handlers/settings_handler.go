package handlers

import (
	"encoding/json"
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type SettingsHandler struct {
	svc services.ConfigServiceInterface
}

func NewSettingsHandler(svc services.ConfigServiceInterface) *SettingsHandler {
	return &SettingsHandler{
		svc: svc,
	}
}

func (h *SettingsHandler) GetGlobalSettings(w http.ResponseWriter, r *http.Request) {
	config, err := h.svc.GetGateway(r.Context())
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKGatewaySettings(config))
}

// SetSettingRequest is the set-setting body. Value mirrors the gateway's typed
// SettingValue: a JSON string, boolean or integer, sent as the kind it is.
type SetSettingRequest struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

func (h *SettingsHandler) SetGlobalSetting(w http.ResponseWriter, r *http.Request) {
	var body SetSettingRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.Key == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidSetting, "key is required")
		return
	}
	value, err := models.ParseSDKSettingValue(body.Value)
	if err != nil {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidSetting, err.Error())
		return
	}
	if _, err = h.svc.Update(r.Context(), "", &openshell.ConfigUpdate{
		SettingKey:   body.Key,
		SettingValue: value,
		Global:       true,
	}); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (h *SettingsHandler) DeleteGlobalSetting(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidSetting, "key query parameter is required")
		return
	}
	if _, err := h.svc.Update(r.Context(), "", &openshell.ConfigUpdate{
		SettingKey:    key,
		DeleteSetting: true,
		Global:        true,
	}); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
