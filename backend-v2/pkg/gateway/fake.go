package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/auth"
)

// Fake is an in-memory Interface implementation for local dev and tests —
// a mock of the single client/mock SDK connection every domain service
// talks through. Swap it for a real gRPC-backed client (see
// backend/internal/gateway.Client for the production pattern) without
// touching any service or handler code — that substitutability is the
// entire point of depending on Interface.
//
// It also demonstrates the auth context plumbing end to end: on every call
// it reads the bearer token / user off ctx via pkg/auth, exactly like the
// real Client's grpc.PerRPCCredentials does before dialing the gateway
// (backend/internal/gateway/client.go). It never logs the token itself —
// only whether one was present and who the auth proxy said the user was.
type Fake struct {
	logger    *slog.Logger
	mu        sync.Mutex
	sandboxes map[string]*SandboxRecord // key: workspace/name
	providers map[string]*ProviderRecord
}

// NewFake constructs an empty in-memory gateway.
func NewFake(logger *slog.Logger) *Fake {
	if logger == nil {
		logger = slog.Default()
	}
	return &Fake{
		logger:    logger,
		sandboxes: make(map[string]*SandboxRecord),
		providers: make(map[string]*ProviderRecord),
	}
}

func key(workspace, name string) string { return workspace + "/" + name }

// logCall is the fake's stand-in for tokenCredentials.GetRequestMetadata in
// the real client — it's where a per-RPC concern (auth) hooks in without
// the service or handler layers knowing.
func (f *Fake) logCall(ctx context.Context, rpc string) {
	f.logger.Debug("gateway call", "rpc", rpc, "user", auth.UserFromContext(ctx), "hasToken", auth.TokenFromContext(ctx) != "")
}

func (f *Fake) CreateSandbox(ctx context.Context, workspace, name, image string, labels map[string]string) (*SandboxRecord, error) {
	f.logCall(ctx, "CreateSandbox")
	f.mu.Lock()
	defer f.mu.Unlock()
	k := key(workspace, name)
	if _, exists := f.sandboxes[k]; exists {
		return nil, fmt.Errorf("sandbox %q already exists", k)
	}
	rec := &SandboxRecord{Name: name, Workspace: workspace, Image: image, Phase: "READY", Labels: labels}
	f.sandboxes[k] = rec
	return rec, nil
}

func (f *Fake) GetSandbox(ctx context.Context, workspace, name string) (*SandboxRecord, error) {
	f.logCall(ctx, "GetSandbox")
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.sandboxes[key(workspace, name)]
	if !ok {
		return nil, fmt.Errorf("sandbox %q not found", key(workspace, name))
	}
	return rec, nil
}

func (f *Fake) ListSandboxes(ctx context.Context, workspace string) ([]*SandboxRecord, error) {
	f.logCall(ctx, "ListSandboxes")
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*SandboxRecord, 0)
	for _, rec := range f.sandboxes {
		if rec.Workspace == workspace {
			out = append(out, rec)
		}
	}
	return out, nil
}

func (f *Fake) DeleteSandbox(ctx context.Context, workspace, name string) error {
	f.logCall(ctx, "DeleteSandbox")
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sandboxes, key(workspace, name))
	return nil
}

func (f *Fake) CreateProvider(ctx context.Context, workspace, name, ptype string, config map[string]string) (*ProviderRecord, error) {
	f.logCall(ctx, "CreateProvider")
	f.mu.Lock()
	defer f.mu.Unlock()
	k := key(workspace, name)
	if _, exists := f.providers[k]; exists {
		return nil, fmt.Errorf("provider %q already exists", k)
	}
	rec := &ProviderRecord{Name: name, Workspace: workspace, Type: ptype, Config: config}
	f.providers[k] = rec
	return rec, nil
}

func (f *Fake) GetProvider(ctx context.Context, workspace, name string) (*ProviderRecord, error) {
	f.logCall(ctx, "GetProvider")
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.providers[key(workspace, name)]
	if !ok {
		return nil, fmt.Errorf("provider %q not found", key(workspace, name))
	}
	return rec, nil
}

func (f *Fake) ListProviders(ctx context.Context, workspace string) ([]*ProviderRecord, error) {
	f.logCall(ctx, "ListProviders")
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*ProviderRecord, 0)
	for _, rec := range f.providers {
		if rec.Workspace == workspace {
			out = append(out, rec)
		}
	}
	return out, nil
}

func (f *Fake) DeleteProvider(ctx context.Context, workspace, name string) error {
	f.logCall(ctx, "DeleteProvider")
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.providers, key(workspace, name))
	return nil
}

// Verify *Fake implements Interface at compile time.
var _ Interface = (*Fake)(nil)
