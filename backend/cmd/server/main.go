// The OpenShell Dashboard BFF: serves the REST API for the React frontend and
// (optionally) the built static assets, talking to the OpenShell gateway over
// gRPC with per-request bearer token forwarding.
//
// Authentication is delegated to an external auth proxy (oauth2-proxy,
// kube-rbac-proxy, etc.) which injects the bearer token as an HTTP header.
// The BFF reads that header and forwards the token to the gateway.
package main

import (
	"crypto/rand"
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
		origins       = flag.String("allowed-origins", envOr("ALLOWED_ORIGINS", ""), "comma-separated CORS origins (env ALLOWED_ORIGINS)")
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

	// Federated mode = an auth proxy fronts the BFF (no in-app OIDC issuer).
	// Only then is the x-forwarded-access-token header trustworthy; in
	// standalone mode any client could forge it to bypass the session cookie.
	federated := os.Getenv("OIDC_ISSUER") == "" && !*authDisabled

	authMiddleware := auth.New(auth.Config{
		Disabled:         *authDisabled,
		TokenHeader:      *tokenHeader,
		UserHeader:       *userHeader,
		TrustProxyHeader: federated,
	})

	// Cookie sessions are only used in standalone OIDC mode. SESSION_SECRET
	// must be set explicitly outside dev: an auto-generated secret means every
	// restart invalidates all sessions, and each replica gets a different key
	// so cookies sealed on one pod fail to decrypt on another — surfacing as
	// intermittent random logouts. Fail closed unless DEPLOYMENT_CONTEXT=dev.
	var sessionCodec *auth.SessionCodec
	if issuer := os.Getenv("OIDC_ISSUER"); issuer != "" && !*authDisabled {
		secret := os.Getenv("SESSION_SECRET")
		if secret == "" {
			if os.Getenv("DEPLOYMENT_CONTEXT") != "dev" {
				slog.Error("SESSION_SECRET is required when OIDC is configured (set DEPLOYMENT_CONTEXT=dev to allow an ephemeral secret for local development)")
				os.Exit(1)
			}
			generated := make([]byte, 32)
			if _, err := rand.Read(generated); err != nil {
				slog.Error("failed to generate a session secret", "error", err)
				os.Exit(1)
			}
			secret = string(generated)
			slog.Warn("SESSION_SECRET not set — using an ephemeral dev secret; sessions won't survive restarts")
		}
		codec, err := auth.NewSessionCodec([]byte(secret))
		if err != nil {
			slog.Error("session codec setup failed", "error", err)
			os.Exit(1)
		}
		sessionCodec = codec
	}

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
	for _, o := range strings.Split(*origins, ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			allowedOrigins = append(allowedOrigins, trimmed)
		}
	}

	app := api.NewApp(gatewayClient, authMiddleware, sessionCodec, *staticDir, allowedOrigins, authCfg)
	// Optional confidential-client secret for the IdP token endpoint (env
	// only — never a flag, so it can't leak into process listings).
	if secret := os.Getenv("OIDC_CLIENT_SECRET"); secret != "" {
		app.SetOIDCClientSecret(secret)
	}

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
