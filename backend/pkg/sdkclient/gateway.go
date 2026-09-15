package sdkclient

import (
	"fmt"
	"log/slog"
	"strings"

	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// GatewayClients are the per-gateway clients an App needs: the SDK client for
// the OpenShell API, and the raw-exec client for binary-safe uploads.
//
// One set per gateway. A host fronting several gateways builds several — the
// clients differ only in endpoint, because ContextAuthProvider resolves the
// caller's bearer per request rather than binding one at construction.
type GatewayClients struct {
	SDK        openshell.ClientInterface
	UploadExec *RawExecClient
}

// Close releases both clients, logging rather than failing on error.
func (c *GatewayClients) Close() {
	if c == nil {
		return
	}
	if c.SDK != nil {
		if err := c.SDK.Close(); err != nil {
			slog.Warn("SDK client close failed", "error", err)
		}
	}
	if c.UploadExec != nil {
		if err := c.UploadExec.Close(); err != nil {
			slog.Warn("upload exec client close failed", "error", err)
		}
	}
}

// NewGatewayClients dials one OpenShell gateway.
//
// gatewayURL accepts grpc://, grpcs://, http://, https:// or a bare host:port;
// TLS is inferred from the scheme. Certificate paths are optional, and mTLS
// requires both a client certificate and key or neither.
func NewGatewayClients(gatewayURL, caCert, clientCert, clientKey string) (*GatewayClients, error) {
	useTLS := strings.HasPrefix(gatewayURL, "grpcs://") || strings.HasPrefix(gatewayURL, "https://")
	address := NormalizeGatewayAddress(gatewayURL, useTLS)

	if (clientCert == "") != (clientKey == "") {
		return nil, fmt.Errorf("gateway mTLS requires both a client certificate and key")
	}

	cfg := openshell.Config{
		Address: address,
		Auth:    ContextAuthProvider{RequireTLS: useTLS},
	}
	if useTLS {
		tlsCfg := &openshell.TLSConfig{CAFile: caCert}
		if clientCert != "" {
			tlsCfg.CertFile = clientCert
			tlsCfg.KeyFile = clientKey
		}
		cfg.TLS = tlsCfg
	} else {
		cfg.TLS = &openshell.TLSConfig{Insecure: true}
	}

	sdkClient, err := openshell.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("SDK client setup failed: %w", err)
	}

	rawHost := strings.TrimPrefix(strings.TrimPrefix(address, "https://"), "http://")
	uploadExec, err := NewRawExecClient(rawHost, caCert, clientCert, clientKey, useTLS)
	if err != nil {
		if closeErr := sdkClient.Close(); closeErr != nil {
			slog.Warn("SDK client close failed during setup rollback", "error", closeErr)
		}
		return nil, fmt.Errorf("upload exec client setup failed: %w", err)
	}

	return &GatewayClients{SDK: sdkClient, UploadExec: uploadExec}, nil
}

// NormalizeGatewayAddress maps the accepted gateway URL forms onto the http(s)
// address the SDK expects.
func NormalizeGatewayAddress(gatewayURL string, useTLS bool) string {
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
