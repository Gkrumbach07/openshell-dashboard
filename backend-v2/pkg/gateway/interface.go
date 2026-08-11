// Package gateway defines the OpenShell gRPC surface this BFF depends on.
//
// In the real dashboard (backend/internal/gateway) this interface is backed
// by a *Client wrapping protoc-generated stubs (gen/openshellv1, etc.) and
// forwards the caller's bearer token per ADR 0002. This reference BFF trims
// the interface to Sandbox + Provider RPCs to keep the example readable —
// Policy, Inference, and Observability would extend it the same way.
package gateway

import "context"

// Interface for the client that will interface with the gateway SDK or other method
type Interface interface {
	// Sandboxes
	CreateSandbox(ctx context.Context, workspace, name, image string, labels map[string]string) (*SandboxRecord, error)
	GetSandbox(ctx context.Context, workspace, name string) (*SandboxRecord, error)
	ListSandboxes(ctx context.Context, workspace string) ([]*SandboxRecord, error)
	DeleteSandbox(ctx context.Context, workspace, name string) error

	// Providers
	CreateProvider(ctx context.Context, workspace, name, ptype string, config map[string]string) (*ProviderRecord, error)
	GetProvider(ctx context.Context, workspace, name string) (*ProviderRecord, error)
	ListProviders(ctx context.Context, workspace string) ([]*ProviderRecord, error)
	DeleteProvider(ctx context.Context, workspace, name string) error
}

// SandboxRecord is the gateway-layer representation, analogous to
// gen/openshellv1.Sandbox in the real client.
type SandboxRecord struct {
	Name      string
	Workspace string
	Image     string
	Phase     string
	Labels    map[string]string
}

// ProviderRecord is the gateway-layer representation, analogous to
// gen/datamodelv1.Provider in the real client.
type ProviderRecord struct {
	Name            string
	Workspace       string
	Type            string
	Config          map[string]string
	CredentialNames []string
}
