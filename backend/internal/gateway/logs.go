package gateway

import (
	"context"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// GetSandboxLogs fetches recent logs one-shot (the dashboard polls this; no
// streaming). NOTE: the RPC takes sandbox_id (UUID from metadata.id), not the
// sandbox name — callers resolve name → id via GetSandbox first.
func (c *Client) GetSandboxLogs(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error) {
	return c.openshell.GetSandboxLogs(ctx, &openshellv1.GetSandboxLogsRequest{
		SandboxId: sandboxID,
		Lines:     lines,
		SinceMs:   sinceMs,
		Sources:   sources,
		MinLevel:  minLevel,
		Workspace: workspace,
	})
}

// ListSandboxProviders lists provider records attached to a sandbox (by name).
func (c *Client) ListSandboxProviders(ctx context.Context, workspace, sandboxName string) (*openshellv1.ListSandboxProvidersResponse, error) {
	return c.openshell.ListSandboxProviders(ctx, &openshellv1.ListSandboxProvidersRequest{
		SandboxName: sandboxName,
		Workspace:   workspace,
	})
}

// AttachSandboxProvider attaches a provider to a sandbox with optimistic
// concurrency (expectedResourceVersion 0 = skip the check).
func (c *Client) AttachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.AttachSandboxProviderResponse, error) {
	return c.openshell.AttachSandboxProvider(ctx, &openshellv1.AttachSandboxProviderRequest{
		SandboxName:             sandboxName,
		ProviderName:            providerName,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
}

// DetachSandboxProvider detaches a provider from a sandbox.
func (c *Client) DetachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.DetachSandboxProviderResponse, error) {
	return c.openshell.DetachSandboxProvider(ctx, &openshellv1.DetachSandboxProviderRequest{
		SandboxName:             sandboxName,
		ProviderName:            providerName,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
}
