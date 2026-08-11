// Command api is the entrypoint for downstream-bff: a separate BFF, in its
// own Go module, that CONSUMES backend-v2 as a dependency instead of
// forking it. It reuses backend-v2's auth middleware and gateway wholesale
// (pkg/auth, pkg/gateway — generic infra, low compatibility risk), consumes
// backend-v2's Sandbox domain directly but decorates it with a quota
// feature backend-v2 knows nothing about (pkg/sandboxes), and consumes
// backend-v2's Provider domain as-is since it has no planned customization
// there (pkg/providers). Both domains use the same containment mechanism —
// their own package, isolated from the rest of this codebase — rather than
// an extra local-interface translation layer; see pkg/sandboxes' package
// doc for why that layer wasn't earning its keep here.
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
	"github.com/Gkrumbach07/openshell-dashboard/downstream-bff/pkg/providers"
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

	// Sandbox: consume upstream's Service directly, decorated with the
	// quota feature. sandboxService's static type stays sandbox.Service
	// throughout — the handler never knows QuotaEnforcer exists.
	var sandboxService sandbox.Service = sandbox.NewService(gw)
	sandboxService = sandboxes.NewQuotaEnforcer(sandboxService, cfg.SandboxQuotaPerWorkspace)
	sandboxHandler := sandboxes.NewHandler(base, sandboxService)

	// Provider: no customization planned, consume upstream's Service directly.
	providerService := upstreamprovider.NewService(gw)
	providerHandler := providers.NewHandler(base, providerService)

	mux := http.NewServeMux()
	sandboxHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/sandboxes")
	providerHandler.RegisterRoutes(mux, "/api/v1/workspaces/{workspace}/providers")

	root := authMW.Handler(mux)

	logger.Info("downstream-bff listening",
		"addr", ":"+cfg.Port,
		"sandboxQuotaPerWorkspace", cfg.SandboxQuotaPerWorkspace,
		"authDisabled", cfg.AuthDisabled,
	)
	if err := http.ListenAndServe(":"+cfg.Port, root); err != nil { //nolint:gosec // demo server, no timeouts needed
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
