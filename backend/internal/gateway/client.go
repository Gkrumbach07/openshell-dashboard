// Package gateway is a thin wrapper over the protoc-generated OpenShell gRPC
// stubs. It wraps only the user-facing RPCs the dashboard needs (Phase 1) and
// forwards the caller's OIDC bearer token on every RPC.
package gateway

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/Gkrumbach07/openshell-dashboard/backend/internal/auth"

	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// Client wraps the OpenShell gateway gRPC connection.
type Client struct {
	conn      *grpc.ClientConn
	openshell openshellv1.OpenShellClient
	inference inferencev1.InferenceClient
}

// tokenCredentials implements grpc.PerRPCCredentials by forwarding the OIDC
// bearer token stored on the request context by the auth middleware.
type tokenCredentials struct {
	requireTLS bool
}

func (c tokenCredentials) GetRequestMetadata(ctx context.Context, _ ...string) (map[string]string, error) {
	token := auth.TokenFromContext(ctx)
	if token == "" {
		return nil, nil
	}
	return map[string]string{"authorization": "Bearer " + token}, nil
}

func (c tokenCredentials) RequireTransportSecurity() bool {
	return c.requireTLS
}

// New connects to the OpenShell gateway. The URL may be a bare host:port
// (plaintext) or prefixed with grpcs:// / https:// for TLS. If caCertPath
// is non-empty, the PEM file is loaded into the TLS RootCAs pool for
// trusting self-signed certificates.
func New(gatewayURL, caCertPath string) (*Client, error) {
	target := gatewayURL
	useTLS := false
	for _, prefix := range []string{"grpcs://", "https://"} {
		if strings.HasPrefix(target, prefix) {
			target = strings.TrimPrefix(target, prefix)
			useTLS = true
		}
	}
	for _, prefix := range []string{"grpc://", "http://"} {
		target = strings.TrimPrefix(target, prefix)
	}

	transport := insecure.NewCredentials()
	if useTLS {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if caCertPath != "" {
			caCert, err := os.ReadFile(caCertPath)
			if err != nil {
				return nil, fmt.Errorf("read CA cert %q: %w", caCertPath, err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(caCert) {
				return nil, fmt.Errorf("failed to parse CA cert %q", caCertPath)
			}
			tlsCfg.RootCAs = pool
		}
		transport = credentials.NewTLS(tlsCfg)
	}

	conn, err := grpc.NewClient(target,
		grpc.WithTransportCredentials(transport),
		grpc.WithPerRPCCredentials(tokenCredentials{requireTLS: useTLS}),
	)
	if err != nil {
		return nil, fmt.Errorf("connect to gateway %q: %w", gatewayURL, err)
	}

	return &Client{
		conn:      conn,
		openshell: openshellv1.NewOpenShellClient(conn),
		inference: inferencev1.NewInferenceClient(conn),
	}, nil
}

// Close tears down the gRPC connection.
func (c *Client) Close() error {
	return c.conn.Close()
}

// Health checks gateway health (unauthenticated RPC).
func (c *Client) Health(ctx context.Context) (*openshellv1.HealthResponse, error) {
	resp, err := c.openshell.Health(ctx, &openshellv1.HealthRequest{})
	if err != nil {
		return nil, fmt.Errorf("health check: %w", err)
	}
	return resp, nil
}

// GetGatewayInfo fetches gateway status, version, and compute drivers.
func (c *Client) GetGatewayInfo(ctx context.Context) (*openshellv1.GetGatewayInfoResponse, error) {
	resp, err := c.openshell.GetGatewayInfo(ctx, &openshellv1.GetGatewayInfoRequest{})
	if err != nil {
		return nil, fmt.Errorf("get gateway info: %w", err)
	}
	return resp, nil
}

// GetCurrentUser returns the authenticated user's identity from the gateway.
func (c *Client) GetCurrentUser(ctx context.Context) (*openshellv1.GetCurrentUserResponse, error) {
	resp, err := c.openshell.GetCurrentUser(ctx, &openshellv1.GetCurrentUserRequest{})
	if err != nil {
		return nil, fmt.Errorf("get current user: %w", err)
	}
	return resp, nil
}

func (c *Client) ExecSandboxInteractive(ctx context.Context) (openshellv1.OpenShell_ExecSandboxInteractiveClient, error) {
	return c.openshell.ExecSandboxInteractive(ctx)
}
