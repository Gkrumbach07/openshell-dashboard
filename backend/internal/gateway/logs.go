package gateway

import (
	"context"
	"fmt"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// GetSandboxLogs fetches recent logs one-shot (the dashboard polls this; no
// streaming). NOTE: the RPC takes sandbox_id (UUID from metadata.id), not the
// sandbox name — callers resolve name → id via GetSandbox first.
func (c *Client) GetSandboxLogs(ctx context.Context, workspace, sandboxID string, lines uint32, sinceMs int64, sources []string, minLevel string) (*openshellv1.GetSandboxLogsResponse, error) {
	resp, err := c.openshell.GetSandboxLogs(ctx, &openshellv1.GetSandboxLogsRequest{
		SandboxId: sandboxID,
		Lines:     lines,
		SinceMs:   sinceMs,
		Sources:   sources,
		MinLevel:  minLevel,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get sandbox logs %q in workspace %q: %w", sandboxID, workspace, err)
	}
	return resp, nil
}

// ListSandboxProviders lists provider records attached to a sandbox (by name).
func (c *Client) ListSandboxProviders(ctx context.Context, workspace, sandboxName string) (*openshellv1.ListSandboxProvidersResponse, error) {
	resp, err := c.openshell.ListSandboxProviders(ctx, &openshellv1.ListSandboxProvidersRequest{
		SandboxName: sandboxName,
		Workspace:   workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("list sandbox providers %q in workspace %q: %w", sandboxName, workspace, err)
	}
	return resp, nil
}

// AttachSandboxProvider attaches a provider to a sandbox with optimistic
// concurrency (expectedResourceVersion 0 = skip the check).
func (c *Client) AttachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.AttachSandboxProviderResponse, error) {
	resp, err := c.openshell.AttachSandboxProvider(ctx, &openshellv1.AttachSandboxProviderRequest{
		SandboxName:             sandboxName,
		ProviderName:            providerName,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("attach provider %q to sandbox %q in workspace %q: %w", providerName, sandboxName, workspace, err)
	}
	return resp, nil
}

// DetachSandboxProvider detaches a provider from a sandbox.
func (c *Client) DetachSandboxProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*openshellv1.DetachSandboxProviderResponse, error) {
	resp, err := c.openshell.DetachSandboxProvider(ctx, &openshellv1.DetachSandboxProviderRequest{
		SandboxName:             sandboxName,
		ProviderName:            providerName,
		ExpectedResourceVersion: expectedResourceVersion,
		Workspace:               workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("detach provider %q from sandbox %q in workspace %q: %w", providerName, sandboxName, workspace, err)
	}
	return resp, nil
}
