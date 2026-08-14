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
