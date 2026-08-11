// Command api is the entrypoint for downstream-bff: a separate BFF, in its
// own Go module, that CONSUMES backend-v2 as a dependency instead of
// forking it. It reuses backend-v2's auth middleware and gateway wholesale
// (pkg/auth, pkg/gateway — generic infra, low compatibility risk).
//
// Two different consumption patterns are shown side by side:
//
//   - Provider: no customization needed, so this BFF reuses backend-v2's
//     provider.NewProviderHandler directly — no local package, no local
//     interface, zero duplicate code.
//   - Sandbox: decorated with a quota feature (pkg/sandboxes.QuotaEnforcer)
//     AND a genuinely new capability, RestartSandbox, that doesn't exist on
//     backend-v2's sandbox.Service at all (pkg/sandboxes.ExtendedService /
//     NewRestarter). Because the handler needs to expose a method upstream
//     doesn't have, it can't reuse backend-v2's SandboxHandler — it's
//     rewritten in pkg/sandboxes/handler.go against this BFF's own
//     ExtendedService interface instead.
//
// See ../README.md for the versioning/pinning story: in a real multi-repo
// setup, the `require` line in go.mod below is what pins the exact
// backend-v2 release this BFF was built and tested against.
package main

import (
	"log/slog"
	"net/http"
	"os"

	upstreamauth "github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/auth"
	upstreamgateway "github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/gateway"
	upstreamhttpx "github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/httpx"
	upstreamprovider "github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/provider"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"

	"github.com/Gkrumbach07/openshell-dashboard/downstream-bff/internal/config"
	"github.com/Gkrumbach07/openshell-dashboard/downstream-bff/pkg/sandboxes"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	cfg := config.Load()

	if cfg.AuthDisabled {
		logger.Warn("AUTH_DISABLED=true — authentication is OFF; never use this outside local development")
	}

	// Reused wholesale from backend-v2 — same relay-only model, same
	// context-based token plumbing, zero reimplementation.
	authMW := upstreamauth.New(upstreamauth.Config{
		Disabled:    cfg.AuthDisabled,
		TokenHeader: cfg.TokenHeader,
		UserHeader:  cfg.UserHeader,
	})
	gw := upstreamgateway.NewFake(logger)
	base := upstreamhttpx.NewHandler(logger)

	// Sandbox: consume upstream's Service, decorate with the quota feature
	// (still typed sandbox.Service — QuotaEnforcer adds no new methods),
	// then adapt into ExtendedService to add RestartSandbox — a capability
	// backend-v2 doesn't have. sandboxes.NewHandler depends on
	// ExtendedService, not sandbox.Service, because it needs to expose
	// the extra method.
	sandboxService := sandbox.NewService(gw)
	sandboxService = sandboxes.NewQuotaEnforcer(sandboxService, cfg.SandboxQuotaPerWorkspace)
	extendedSandboxService := sandboxes.NewRestarter(sandboxService)
	sandboxHandler := sandboxes.NewHandler(base, extendedSandboxService)

	// Provider: no customization planned, no local interface, no local
	// handler — reuse backend-v2's exported handler unmodified.
	providerService := upstreamprovider.NewService(gw)
	providerHandler := upstreamprovider.NewProviderHandler(base, providerService)

	mux := http.NewServeMux()
	sandboxHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/sandboxes")
	providerHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/providers")

	root := authMW.Handler(mux)

	logger.Info(
		"downstream-bff listening",
		"addr", ":"+cfg.Port,
		"sandboxQuotaPerWorkspace", cfg.SandboxQuotaPerWorkspace,
		"authDisabled", cfg.AuthDisabled,
	)
	if err := http.ListenAndServe(":"+cfg.Port, root); err != nil { //nolint:gosec // demo server, no timeouts needed
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
