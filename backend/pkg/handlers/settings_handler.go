package handlers

import (
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
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

type SetSettingRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
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
	if _, err := h.svc.Update(r.Context(), "", &openshell.ConfigUpdate{
		SettingKey:   body.Key,
		SettingValue: &openshell.SettingValue{Type: openshell.SettingValueString, StringVal: body.Value},
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
