package gateway

import (
	"context"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// WatchSandbox opens the server-streaming WatchSandbox RPC. The caller owns
// the stream lifecycle: cancel ctx to stop the gateway-side producer.
func (c *Client) WatchSandbox(ctx context.Context, req *openshellv1.WatchSandboxRequest) (openshellv1.OpenShell_WatchSandboxClient, error) {
	return c.openshell.WatchSandbox(ctx, req)
}
