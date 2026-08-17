package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type GatewayHandler struct {
	*Handler                               // You can use gatewayHandler.logger now or other Handler fields (first class field)
	gatewayService services.gatewayService // service interface
	// fields specific to this handler
}

func NewGatewayHandler(svc service.gatewayService) {
	return &GatewayHandler{
		Handler:        &Handler{logger: slog.Default()},
		gatewayService: svc,
	}
}

func (h *GatewayHandler) RegisterRoutes(r chi.Router) {
	// r.Use(h.someGatewaySpecificMiddleware)

	r.Get("/", h.GetGatewayInfo)
	r.Post("/process", h.ProcessGateway)
	r.Get("/{id}", h.GetGatewayByID)
}

func (h *GatewayHandler) CreateGateway(w http.ResponseWriter, r *http.Request) {
	// can be a model
	var req struct {
		Name string `json:"name"`
	}

	// validate model
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Pass r.Context() down into the service for request scoped variables
	provider, err := h.gatewayService.CreateProvider(r.Context(), req.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(provider)
}
