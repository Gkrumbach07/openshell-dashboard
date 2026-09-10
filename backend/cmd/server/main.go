// The OpenShell Dashboard BFF: serves the REST API for the React frontend and
// (optionally) the built static assets, talking to the OpenShell gateway over
// gRPC with per-request bearer token forwarding.
//
// The BFF is a token relay (ADR 0002): authentication is owned by an external
// auth proxy (oauth2-proxy, kube-auth-proxy, ...) which injects the user's
// bearer token as an HTTP header. The BFF reads that header — or an explicit
// Authorization: Bearer from API clients — and forwards the token to the
// gateway, which validates it against its own OIDC JWKS. The BFF never runs
// OIDC flows, never holds sessions, and never validates tokens.
package main

import (
	"context"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/auth"
	api "github.com/Gkrumbach07/openshell-dashboard/backend/pkg/handlers"
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
		tlsCert           = flag.String("tls-cert", envOr("TLS_CERT_FILE", ""), "path to server cert for inbound HTTPS (env TLS_CERT_FILE)")
		tlsKey            = flag.String("tls-key", envOr("TLS_KEY_FILE", ""), "path to server key for inbound HTTPS (env TLS_KEY_FILE)")
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

	warnGatewayConfig(*gatewayURL, *gatewayCACert, *authDisabled)
	if err := validateInboundTLS(*tlsCert, *tlsKey); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
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

	clients, err := newGatewayClients(*gatewayURL, *gatewayCACert, *gatewayClientCert, *gatewayClientKey)
	if err != nil {
		exitOnError("gateway client setup failed", err)
	}
	defer clients.Close()

	app := api.NewApp(clients.sdk, clients.uploadExec, authMiddleware, *staticDir, authCfg)

	addr := net.JoinHostPort(*listenAddress, *port)
	slog.Info("openshell-dashboard BFF listening",
		"addr", addr,
		"scheme", inboundScheme(*tlsCert, *tlsKey),
		"gateway", *gatewayURL,
		"static", *staticDir,
		"authDisabled", *authDisabled,
	)

	server := newInboundServer(addr, app.Routes())
	errCh := make(chan error, 1)
	go func() {
		errCh <- serveInbound(server, *tlsCert, *tlsKey)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil {
			exitOnError("server exited", err)
		}
		return
	case sig := <-sigCh:
		signal.Stop(sigCh)
		slog.Info("shutting down BFF", "signal", sig.String())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		exitOnError("server shutdown failed", err)
	}

	if err := <-errCh; err != nil && err != http.ErrServerClosed {
		exitOnError("server exited", err)
	}
}
