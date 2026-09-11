package handlers

import (
	"net/http"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

// SetInferenceRouteRequest configures how inference.local resolves for the
// workspace's sandboxes.
type SetInferenceRouteRequest struct {
	RouteName    string `json:"routeName,omitempty"`
	ProviderName string `json:"providerName"`
	ModelID      string `json:"modelId"`
	TimeoutSecs  uint64 `json:"timeoutSecs,omitempty"`
	NoVerify     bool   `json:"noVerify,omitempty"`
}

type InferenceHandler struct {
	svc services.InferenceServiceInterface
}

func NewInferenceHandler(svc services.InferenceServiceInterface) *InferenceHandler {
	return &InferenceHandler{svc: svc}
}

// GetInferenceRoute fetches the workspace inference route. ?route=sandbox-system
// targets the system route; default is the user-facing inference.local route.
func (h *InferenceHandler) GetInferenceRoute(w http.ResponseWriter, r *http.Request) {
	route, err := h.svc.GetRoute(r.Context(), r.PathValue("workspace"), r.URL.Query().Get("route"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKInferenceRoute(route))
}

// SetInferenceRoute sets the workspace inference route.
func (h *InferenceHandler) SetInferenceRoute(w http.ResponseWriter, r *http.Request) {
	var body SetInferenceRouteRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.ProviderName == "" || body.ModelID == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidRoute, "providerName and modelId are required")
		return
	}
	route, err := h.svc.SetRoute(
		r.Context(),
		r.PathValue("workspace"),
		&openshell.InferenceRouteConfig{
			RouteName:    body.RouteName,
			ProviderName: body.ProviderName,
			ModelID:      body.ModelID,
			TimeoutSecs:  body.TimeoutSecs,
			NoVerify:     body.NoVerify,
		},
	)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, models.FromSDKInferenceRoute(route))
}

// DeleteInferenceRoute removes the workspace inference route.
func (h *InferenceHandler) DeleteInferenceRoute(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteRoute(r.Context(), r.PathValue("workspace"), r.URL.Query().Get("route")); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
