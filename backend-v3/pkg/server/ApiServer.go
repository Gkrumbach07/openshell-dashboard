package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type ServerConfig struct {
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

type Server struct {
	srv *http.Server
}

type Services struct {
	Gateway  services.Gateway
	Provider services.Provider
}

func NewServer(cfg ServerConfig, svcs Services) *Server {
	r := chi.NewRouter()

	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)

	gatewayHandler := handlers.NewGatewayHandler{Service: svcs.Gateway}
	sandboxHandler := handlers.NewSandboxHandler{Service: svcs.Sandbox}

	r.Route("/api", func(r chi.Router) {
		r.Use(apiSpecificMiddleware)

		r.Route("/gateway", gatewayHandler.RegisterRoutes)
		r.Route("/sandbox", sandboxHandler.RegisterRoutes)
	})

	httpServer := &http.Server{
		Addr:         cfg.Port,
		Handler:      r,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	return &Server{srv: httpServer}
}
