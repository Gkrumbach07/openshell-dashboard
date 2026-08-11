// Command api is the entrypoint for the reference BFF: instantiates the
// gateway, wraps services in decorators, wires handlers, and starts the
// server behind the auth middleware. Compare to backend/cmd/server/main.go —
// same responsibilities (load env, construct dependencies bottom-up, wrap
// with auth, register routes), organized per the migration strategy's
// cmd/ + pkg/ split.
package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/examples/audit"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/internal/config"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/provider"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	cfg := config.Load()

	if cfg.AuthDisabled {
		logger.Warn("AUTH_DISABLED=true — authentication is OFF; never use this outside local development")
	}

	// 0. Auth middleware — relay-only, same model as backend/internal/auth.
	//    Extracts the bearer token onto the request context; never
	//    validates it (the real gateway would).
	authMW := auth.New(auth.Config{
		Disabled:    cfg.AuthDisabled,
		TokenHeader: cfg.TokenHeader,
		UserHeader:  cfg.UserHeader,
	})

	// 1. Gateway — the real BFF would construct *gateway.Client here
	//    (gRPC dial + bearer-token relay per ADR 0002); the fake keeps this
	//    example runnable without a live OpenShell gateway. It still reads
	//    the token/user off ctx (internal/auth.TokenFromContext /
	//    UserFromContext) exactly like the real client's PerRPCCredentials.
	gw := gateway.NewFake(logger)

	// 2. Services — default implementation, then optionally decorated.
	//    Handlers below only ever see the Service interface, so this line
	//    is the *only* place that knows whether decoration happened.
	var sandboxService sandbox.Service = sandbox.NewService(gw)
	if cfg.AuditDecorators {
		sandboxService = audit.NewAuditingSandboxService(sandboxService, logger)
	}
	providerService := provider.NewService(gw)

	// 3. Handlers — each gets its own constructor and narrow dependencies.
	base := httpx.NewHandler(logger)
	sandboxHandler := sandbox.NewSandboxHandler(base, sandboxService)
	providerHandler := provider.NewProviderHandler(base, providerService)

	// 4. Routes.
	mux := http.NewServeMux()
	sandboxHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/sandboxes")
	providerHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/providers")

	// 5. Wrap with auth middleware — every route requires a bearer token
	//    unless AUTH_DISABLED=true.
	root := authMW.Handler(mux)

	logger.Info("backend-v2 reference BFF listening",
		"addr", ":"+cfg.Port,
		"auditDecorators", cfg.AuditDecorators,
		"authDisabled", cfg.AuthDisabled,
	)
	if err := http.ListenAndServe(":"+cfg.Port, root); err != nil { //nolint:gosec // demo server, no timeouts needed
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
