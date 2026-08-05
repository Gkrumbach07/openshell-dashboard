// The OpenShell Dashboard BFF: serves the REST API for the React frontend and
// (optionally) the built static assets, talking to the OpenShell gateway over
// gRPC with per-request bearer token forwarding.
//
// Authentication is delegated to an external auth proxy (oauth2-proxy,
// kube-rbac-proxy, etc.) which injects the bearer token as an HTTP header.
// The BFF reads that header and forwards the token to the gateway.
package main

import (
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

const (
	defaultPort       = "8080"
	defaultGatewayURL = "localhost:50051"
)

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	var (
		port          = flag.String("port", envOr("PORT", defaultPort), "listen port (env PORT)")
		gatewayURL    = flag.String("gateway-url", envOr("OPENSHELL_GATEWAY_URL", defaultGatewayURL), "OpenShell gateway gRPC endpoint (env OPENSHELL_GATEWAY_URL)")
		gatewayCACert = flag.String("gateway-ca-cert", envOr("GATEWAY_CA_CERT", ""), "path to CA cert for gateway TLS (env GATEWAY_CA_CERT)")
		staticDir     = flag.String("static-dir", envOr("STATIC_DIR", ""), "frontend static assets directory (env STATIC_DIR)")
		authDisabled  = flag.Bool("auth-disabled", envOr("AUTH_DISABLED", "false") == "true", "skip auth — dev only (env AUTH_DISABLED)")
		origins       = flag.String("allowed-origins", envOr("ALLOWED_ORIGINS", "http://localhost:3000"), "comma-separated CORS origins (env ALLOWED_ORIGINS)")
		tokenHeader   = flag.String("auth-token-header", envOr("AUTH_TOKEN_HEADER", "x-forwarded-access-token"), "header injected by auth proxy containing the bearer token (env AUTH_TOKEN_HEADER)")
		userHeader    = flag.String("auth-user-header", envOr("AUTH_USER_HEADER", "x-auth-request-user"), "header injected by auth proxy containing the username (env AUTH_USER_HEADER)")
		adminRole     = flag.String("admin-role", envOr("ADMIN_ROLE", "admin"), "role name that grants platform admin access (env ADMIN_ROLE)")
		logoutURL     = flag.String("logout-url", envOr("LOGOUT_URL", "/oauth2/sign_out"), "URL to redirect to on logout (env LOGOUT_URL)")
	)
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	if *gatewayURL == defaultGatewayURL {
		slog.Warn("gateway URL is the default — verify OPENSHELL_GATEWAY_URL is configured correctly", "url", *gatewayURL)
	}
	if *authDisabled {
		slog.Warn("AUTH_DISABLED=true — authentication is OFF; never use this outside local development")
	}

	authMiddleware := auth.New(auth.Config{
		Disabled:    *authDisabled,
		TokenHeader: *tokenHeader,
		UserHeader:  *userHeader,
	})

	authCfg := api.AuthConfigResponse{
		AuthDisabled: *authDisabled,
		Issuer:       envOr("OIDC_ISSUER", ""),
		ClientID:     envOr("OIDC_CLIENT_ID", ""),
		Scopes:       envOr("OIDC_SCOPES", "openid profile email groups"),
		AdminRole:    *adminRole,
		UserRole:     envOr("OIDC_USER_ROLE", ""),
		LogoutURL:    *logoutURL,
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
	}

	gatewayClient, err := gateway.New(*gatewayURL, *gatewayCACert)
	if err != nil {
		slog.Error("gateway client setup failed", "error", err)
		os.Exit(1)
	}
	defer gatewayClient.Close()

	var allowedOrigins []string
	if *origins != "" {
		allowedOrigins = strings.Split(*origins, ",")
	}

	app := api.NewApp(gatewayClient, authMiddleware, *staticDir, allowedOrigins, authCfg)

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
