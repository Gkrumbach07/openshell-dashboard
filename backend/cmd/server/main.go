// The OpenShell Dashboard BFF: serves the REST API for the React frontend and
// (optionally) the built static assets, talking to the OpenShell gateway over
// gRPC with per-request bearer token forwarding.
//
// The BFF is a token relay (ADR 0014): authentication is owned by an external
// auth proxy (oauth2-proxy, kube-auth-proxy, ...) which injects the user's
// bearer token as an HTTP header. The BFF reads that header — or an explicit
// Authorization: Bearer from API clients — and forwards the token to the
// gateway, which validates it against its own OIDC JWKS. The BFF never runs
// OIDC flows, never holds sessions, and never validates tokens.
package main

import (
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/api"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/sdkclient"
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
		port              = flag.String("port", envOr("PORT", defaultPort), "listen port (env PORT)")
		listenAddress     = flag.String("listen-address", envOr("LISTEN_ADDRESS", ""), "listen address (env LISTEN_ADDRESS)")
		gatewayURL        = flag.String("gateway-url", envOr("OPENSHELL_GATEWAY_URL", defaultGatewayURL), "OpenShell gateway gRPC endpoint (env OPENSHELL_GATEWAY_URL)")
		gatewayCACert     = flag.String("gateway-ca-cert", envOr("GATEWAY_CA_CERT", ""), "path to CA cert for gateway TLS (env GATEWAY_CA_CERT)")
		gatewayClientCert = flag.String("gateway-client-cert", envOr("GATEWAY_CLIENT_CERT", ""), "path to client certificate for gateway mTLS (env GATEWAY_CLIENT_CERT)")
		gatewayClientKey  = flag.String("gateway-client-key", envOr("GATEWAY_CLIENT_KEY", ""), "path to client key for gateway mTLS (env GATEWAY_CLIENT_KEY)")
		staticDir         = flag.String("static-dir", envOr("STATIC_DIR", ""), "frontend static assets directory (env STATIC_DIR)")
		authDisabled      = flag.Bool("auth-disabled", envOr("AUTH_DISABLED", "false") == "true", "skip auth — dev only (env AUTH_DISABLED)")
		tokenHeader       = flag.String("auth-token-header", envOr("AUTH_TOKEN_HEADER", "x-forwarded-access-token"), "header injected by auth proxy containing the bearer token (env AUTH_TOKEN_HEADER)")
		userHeader        = flag.String("auth-user-header", envOr("AUTH_USER_HEADER", "x-auth-request-user"), "header injected by auth proxy containing the username (env AUTH_USER_HEADER)")
		adminRole         = flag.String("admin-role", envOr("ADMIN_ROLE", "admin"), "role name that grants platform admin access (env ADMIN_ROLE)")
		logoutURL         = flag.String("logout-url", envOr("LOGOUT_URL", "/oauth2/sign_out"), "auth proxy sign-out URL to redirect to on logout (env LOGOUT_URL)")
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
		AdminRole:    *adminRole,
		LogoutURL:    *logoutURL,
		Features: api.FeatureFlags{
			Terminal:          envOr("FEATURE_TERMINAL", "true") == "true",
			FileTransfer:      envOr("FEATURE_FILE_TRANSFER", "true") == "true",
			Settings:          envOr("FEATURE_SETTINGS", "true") == "true",
			GlobalPolicy:      envOr("FEATURE_GLOBAL_POLICY", "true") == "true",
			CredentialRefresh: envOr("FEATURE_CREDENTIAL_REFRESH", "true") == "true",
			Services:          envOr("FEATURE_SERVICES", "true") == "true",
			DraftPolicy:       envOr("FEATURE_DRAFT_POLICY", "true") == "true",
		},
	}

	gatewayClient, err := gateway.New(*gatewayURL, *gatewayCACert, *gatewayClientCert, *gatewayClientKey)
	if err != nil {
		slog.Error("gateway client setup failed", "error", err)
		os.Exit(1)
	}
	defer gatewayClient.Close()

	useTLS := strings.HasPrefix(*gatewayURL, "grpcs://") || strings.HasPrefix(*gatewayURL, "https://")
	sdkCfg := openshell.Config{
		Address: *gatewayURL,
		Auth:    sdkclient.ContextAuthProvider{RequireTLS: useTLS},
	}
	if *gatewayCACert != "" {
		sdkCfg.TLS = &openshell.TLSConfig{CAFile: *gatewayCACert}
	}
	sdkClient, err := openshell.NewClient(sdkCfg)
	if err != nil {
		slog.Error("SDK client setup failed", "error", err)
		os.Exit(1)
	}
	defer sdkClient.Close()

	app := api.NewApp(gatewayClient, sdkClient, authMiddleware, *staticDir, authCfg)

	addr := net.JoinHostPort(*listenAddress, *port)
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
