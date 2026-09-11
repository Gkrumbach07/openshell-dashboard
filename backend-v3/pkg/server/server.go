// Package server assembles the default upstream router (services ->
// handlers -> routes) and wraps it in an http.Server. It is deliberately
// thin: NewServer wires the concrete pieces main.go hands it and mounts the
// default route tree, then Options get a chance to add more.
package server

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/handlers"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/config"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/endpoint"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/exec"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/file"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/inference"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/policy"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/profile"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/provider"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/refresh"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/sandbox"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/ssh"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/tcp"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/services/workspace"
)

// ServerConfig controls the underlying http.Server.
type ServerConfig struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// Services collects the business-logic interfaces the default routes wire
// up. Every field is an interface, so downstream can pass its own decorated
// implementation in place of upstream's default (see pkg/services/gateway
// for the interface-decoration pattern). Field groups mirror the upstream
// SDK's own sub-client accessors -- see
// https://ro14nd.de/openshell-sdk-go/api/overview.html.
type Services struct {
	Gateway   gateway.Service
	Sandbox   sandbox.Service
	Exec      exec.Service
	Provider  provider.Service
	Profile   profile.Service
	Refresh   refresh.Service
	Endpoint  endpoint.Service
	File      file.Service
	SSH       ssh.Service
	TCP       tcp.Service
	Config    config.Service
	Policy    policy.Service
	Workspace workspace.Service
	Inference inference.Service
}

// Option customizes the router after upstream's default routes are
// mounted. An Option decides everything about how its routes are grouped
// and what middleware runs on them -- upstream never sees or cares which.
type Option func(r chi.Router)

// WithRoutes is a convenience Option for the common case: mount
// registrar's routes at pattern, running mws first (in order) as this
// route group's middleware. Pass middleware.RequireAuth to reuse upstream's
// auth, a custom middleware to run downstream's own, both to layer them, or
// none to mount unauthenticated. Equivalent to calling r.Route(pattern, ...)
// directly, which any Option remains free to do for full control.
func WithRoutes(pattern string, registrar interface{ RegisterRoutes(r chi.Router) }, mws ...func(http.Handler) http.Handler) Option {
	return func(r chi.Router) {
		r.Route(pattern, func(r chi.Router) {
			r.Use(mws...)
			registrar.RegisterRoutes(r)
		})
	}
}

// Server wraps the http.Server built from the default routes plus any
// Option passed to NewServer.
type Server struct {
	srv *http.Server
}

// NewServer builds the router -- default routes first, then opts in order
// -- and the underlying http.Server. It does not start listening; call
// Start for that.
func NewServer(cfg ServerConfig, svcs Services, opts ...Option) *Server {
	r := chi.NewRouter()

	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)

	gatewayHandler := handlers.NewGatewayHandler(svcs.Gateway)
	sandboxHandler := handlers.NewSandboxHandler(svcs.Sandbox)
	execHandler := handlers.NewExecHandler(svcs.Exec)
	providerHandler := handlers.NewProviderHandler(svcs.Provider)
	profileHandler := handlers.NewProfileHandler(svcs.Profile)
	refreshHandler := handlers.NewRefreshHandler(svcs.Refresh)
	endpointHandler := handlers.NewEndpointHandler(svcs.Endpoint)
	fileHandler := handlers.NewFileHandler(svcs.File)
	sshHandler := handlers.NewSSHHandler(svcs.SSH)
	tcpHandler := handlers.NewTCPHandler(svcs.TCP)
	configHandler := handlers.NewConfigHandler(svcs.Config)
	policyHandler := handlers.NewPolicyHandler(svcs.Policy)
	workspaceHandler := handlers.NewWorkspaceHandler(svcs.Workspace)
	inferenceHandler := handlers.NewInferenceHandler(svcs.Inference)

	r.Route("/api", func(r chi.Router) {
		r.Route("/gateway", gatewayHandler.RegisterRoutes)
		r.Route("/workspaces", workspaceHandler.RegisterRoutes)
		r.Route("/providers", providerHandler.RegisterRoutes)
		r.Route("/profiles", profileHandler.RegisterRoutes)
		r.Route("/refresh", refreshHandler.RegisterRoutes)
		r.Route("/inference", inferenceHandler.RegisterRoutes)
		r.Route("/config", configHandler.RegisterRoutes)
		r.Route("/policy", policyHandler.RegisterWorkspaceRoutes)

		r.Route("/sandboxes", func(r chi.Router) {
			sandboxHandler.RegisterRoutes(r)
			r.Route("/{name}/exec", execHandler.RegisterRoutes)
			r.Route("/{name}/services", endpointHandler.RegisterRoutes)
			r.Route("/{name}/files", fileHandler.RegisterRoutes)
			r.Route("/{name}/ssh", sshHandler.RegisterRoutes)
			r.Route("/{name}/tcp", tcpHandler.RegisterRoutes)
			r.Route("/{name}/policy", policyHandler.RegisterRoutes)
		})
	})

	for _, opt := range opts {
		opt(r)
	}

	return &Server{
		srv: &http.Server{
			Addr:         cfg.Addr,
			Handler:      r,
			ReadTimeout:  cfg.ReadTimeout,
			WriteTimeout: cfg.WriteTimeout,
			IdleTimeout:  cfg.IdleTimeout,
		},
	}
}

// Start blocks, serving until the server is shut down or fails.
func (s *Server) Start() error {
	return s.srv.ListenAndServe()
}

// Shutdown gracefully stops the server, waiting for in-flight requests to
// finish or ctx to expire.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.srv.Shutdown(ctx)
}
