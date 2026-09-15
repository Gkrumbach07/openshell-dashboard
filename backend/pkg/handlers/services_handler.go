package handlers

import (
	"net/http"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/apiutils"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/services"
)

type ExposeServiceRequest struct {
	Service    string `json:"service"`
	TargetPort uint32 `json:"targetPort"`
	Domain     bool   `json:"domain"`
}

type ServicesHandler struct {
	svc services.ServiceServiceInterface
}

func NewServicesHandler(svc services.ServiceServiceInterface) *ServicesHandler {
	return &ServicesHandler{
		svc: svc,
	}
}

func (h *ServicesHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	serviceEndpoints, err := h.svc.List(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	out := make([]models.ServiceEndpoint, 0, len(serviceEndpoints))
	for _, svc := range serviceEndpoints {
		out = append(out, models.FromSDKServiceEndpoint(svc))
	}
	apiutils.WriteJSON(w, http.StatusOK, out)
}

func (h *ServicesHandler) ExposeService(w http.ResponseWriter, r *http.Request) {
	var body ExposeServiceRequest
	if !apiutils.DecodeBody(w, r, &body) {
		return
	}
	if body.Service == "" {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidService, "service name is required")
		return
	}
	if body.TargetPort == 0 {
		apiutils.WriteError(w, http.StatusBadRequest, apiutils.InvalidPort, "targetPort must be greater than 0")
		return
	}
	svc, err := h.svc.Expose(r.Context(), r.PathValue("workspace"), r.PathValue("name"), body.Service, body.TargetPort, body.Domain)
	if err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusCreated, models.FromSDKServiceEndpoint(svc))
}

func (h *ServicesHandler) DeleteService(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), r.PathValue("workspace"), r.PathValue("name"), r.PathValue("svc")); err != nil {
		apiutils.WriteSDKError(w, err)
		return
	}
	apiutils.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
