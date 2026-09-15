package main

import (
	"log/slog"
	"os"
	"strings"
)

func warnGatewayConfig(gatewayURL, gatewayCACert string, authDisabled bool) {
	if gatewayURL == defaultGatewayURL {
		slog.Warn("gateway URL is the default — verify OPENSHELL_GATEWAY_URL is configured correctly", "url", gatewayURL)
	}
	if gatewayCACert != "" && !strings.HasPrefix(gatewayURL, "grpcs://") && !strings.HasPrefix(gatewayURL, "https://") {
		slog.Warn(
			"gateway CA cert is set but gateway URL has no TLS scheme; use grpcs:// or https:// for TLS gateways",
			"url", gatewayURL,
			"caCert", gatewayCACert,
		)
	}
	if authDisabled {
		slog.Warn("AUTH_DISABLED=true — authentication is OFF; never use this outside local development")
	}
}

func exitOnError(msg string, err error) {
	slog.Error(msg, "error", err)
	os.Exit(1)
}
