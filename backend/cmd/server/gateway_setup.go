package main

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"

	sdkclient "github.com/Gkrumbach07/openshell-dashboard/backend/pkg/clients"
)

type gatewayClients struct {
	sdk        openshell.ClientInterface
	uploadExec *sdkclient.RawExecClient
}

func (c *gatewayClients) Close() {
	if c.sdk != nil {
		if err := c.sdk.Close(); err != nil {
			slog.Warn("SDK client close failed", "error", err)
		}
	}
	if c.uploadExec != nil {
		if err := c.uploadExec.Close(); err != nil {
			slog.Warn("upload exec client close failed", "error", err)
		}
	}
}

func newGatewayClients(gatewayURL, gatewayCACert, gatewayClientCert, gatewayClientKey string) (*gatewayClients, error) {
	useTLS := strings.HasPrefix(gatewayURL, "grpcs://") || strings.HasPrefix(gatewayURL, "https://")
	sdkAddress := normalizeGatewayAddress(gatewayURL, useTLS)

	if (gatewayClientCert == "") != (gatewayClientKey == "") {
		return nil, fmt.Errorf("gateway mTLS requires both --gateway-client-cert and --gateway-client-key")
	}

	sdkCfg := openshell.Config{
		Address: sdkAddress,
		Auth:    sdkclient.ContextAuthProvider{RequireTLS: useTLS},
	}
	if useTLS {
		tlsCfg := &openshell.TLSConfig{CAFile: gatewayCACert}
		if gatewayClientCert != "" {
			tlsCfg.CertFile = gatewayClientCert
			tlsCfg.KeyFile = gatewayClientKey
		}
		sdkCfg.TLS = tlsCfg
	} else {
		sdkCfg.TLS = &openshell.TLSConfig{Insecure: true}
	}

	sdkClient, err := openshell.NewClient(sdkCfg)
	if err != nil {
		return nil, fmt.Errorf("SDK client setup failed: %w", err)
	}

	rawHost := strings.TrimPrefix(strings.TrimPrefix(sdkAddress, "https://"), "http://")
	uploadExec, err := sdkclient.NewRawExecClient(rawHost, gatewayCACert, gatewayClientCert, gatewayClientKey, useTLS)
	if err != nil {
		if closeErr := sdkClient.Close(); closeErr != nil {
			slog.Warn("SDK client close failed during setup rollback", "error", closeErr)
		}
		return nil, fmt.Errorf("upload exec client setup failed: %w", err)
	}

	return &gatewayClients{sdk: sdkClient, uploadExec: uploadExec}, nil
}

func normalizeGatewayAddress(gatewayURL string, useTLS bool) string {
	switch {
	case strings.HasPrefix(gatewayURL, "grpcs://"):
		return "https://" + strings.TrimPrefix(gatewayURL, "grpcs://")
	case strings.HasPrefix(gatewayURL, "grpc://"):
		return "http://" + strings.TrimPrefix(gatewayURL, "grpc://")
	case strings.HasPrefix(gatewayURL, "https://"), strings.HasPrefix(gatewayURL, "http://"):
		return gatewayURL
	default:
		scheme := "http"
		if useTLS {
			scheme = "https"
		}
		return fmt.Sprintf("%s://%s", scheme, gatewayURL)
	}
}

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
