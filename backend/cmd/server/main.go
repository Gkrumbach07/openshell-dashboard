// The OpenShell Dashboard BFF: serves the REST API for the React frontend and
// (optionally) the built static assets, talking to the OpenShell gateway over
// gRPC with per-request OIDC bearer forwarding.
package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/api"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/gateway"
)

// envOr returns the environment variable value or a default.
func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	var (
		port         = flag.String("port", envOr("PORT", "8080"), "listen port (env PORT)")
		gatewayURL    = flag.String("gateway-url", envOr("OPENSHELL_GATEWAY_URL", "localhost:50051"), "OpenShell gateway gRPC endpoint (env OPENSHELL_GATEWAY_URL)")
		gatewayCACert = flag.String("gateway-ca-cert", envOr("GATEWAY_CA_CERT", ""), "path to CA cert for gateway TLS (env GATEWAY_CA_CERT)")
		oidcIssuer    = flag.String("oidc-issuer", envOr("OIDC_ISSUER", ""), "OIDC issuer URL (env OIDC_ISSUER)")
		oidcClientID = flag.String("oidc-client-id", envOr("OIDC_CLIENT_ID", ""), "OIDC client ID (env OIDC_CLIENT_ID)")
		staticDir    = flag.String("static-dir", envOr("STATIC_DIR", ""), "frontend static assets directory (env STATIC_DIR)")
		authDisabled = flag.Bool("auth-disabled", envOr("AUTH_DISABLED", "false") == "true", "skip OIDC validation — dev only (env AUTH_DISABLED)")
		origins      = flag.String("allowed-origins", envOr("ALLOWED_ORIGINS", "http://localhost:3000"), "comma-separated CORS origins (env ALLOWED_ORIGINS)")
	)
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	if *authDisabled {
		slog.Warn("AUTH_DISABLED=true — OIDC validation is OFF; never use this outside local development")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	authMiddleware, err := auth.New(ctx, auth.Config{
		Disabled: *authDisabled,
		Issuer:   *oidcIssuer,
		ClientID: *oidcClientID,
	})
	if err != nil {
		slog.Error("auth setup failed", "error", err)
		os.Exit(1)
	}
	api.SetAuthConfig(api.AuthConfigResponse{
		AuthDisabled: *authDisabled,
		Issuer:       *oidcIssuer,
		ClientID:     *oidcClientID,
		Scopes:       envOr("OIDC_SCOPES", "openid profile email"),
		AdminRole:    envOr("OIDC_ADMIN_ROLE", "openshell-admin"),
		UserRole:     envOr("OIDC_USER_ROLE", "openshell-user"),
		Features: api.FeatureFlags{
			Terminal:          envOr("FEATURE_TERMINAL", "true") == "true",
			FileTransfer:      envOr("FEATURE_FILE_TRANSFER", "true") == "true",
			Settings:          envOr("FEATURE_SETTINGS", "true") == "true",
			GlobalPolicy:      envOr("FEATURE_GLOBAL_POLICY", "true") == "true",
			CredentialRefresh: envOr("FEATURE_CREDENTIAL_REFRESH", "true") == "true",
			Services:          envOr("FEATURE_SERVICES", "true") == "true",
			DraftPolicy:       envOr("FEATURE_DRAFT_POLICY", "true") == "true",
			DeploymentContext: envOr("DEPLOYMENT_CONTEXT", "standalone"),
			WorkspaceBinding:  envOr("FEATURE_WORKSPACE_BINDING", "false") == "true",
			ResourceLinks:     envOr("FEATURE_RESOURCE_LINKS", "false") == "true",
		},
	})

	gatewayClient, err := gateway.New(*gatewayURL, *gatewayCACert)
	if err != nil {
		slog.Error("gateway client setup failed", "error", err)
		os.Exit(1)
	}
	defer gatewayClient.Close()

	app := api.NewApp(gatewayClient, authMiddleware, *staticDir, strings.Split(*origins, ","))

	addr := ":" + *port
	slog.Info("openshell-dashboard BFF listening",
		"addr", addr,
		"gateway", *gatewayURL,
		"static", *staticDir,
		"authDisabled", *authDisabled,
	)
	server := &http.Server{
		Addr:              addr,
		Handler:           app.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
