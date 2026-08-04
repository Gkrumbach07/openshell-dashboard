package gateway

import (
	"context"
	"fmt"

	inferencev1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/inferencev1"
)

// SetInferenceRoute configures how inference.local routes for a workspace.
// routeName "" targets the user-facing route; "sandbox-system" targets the
// system route used by platform functions.
func (c *Client) SetInferenceRoute(ctx context.Context, workspace, routeName, providerName, modelID string, timeoutSecs uint64, noVerify bool) (*inferencev1.SetInferenceRouteResponse, error) {
	resp, err := c.inference.SetInferenceRoute(ctx, &inferencev1.SetInferenceRouteRequest{
		ProviderName: providerName,
		ModelId:      modelID,
		RouteName:    routeName,
		NoVerify:     noVerify,
		TimeoutSecs:  timeoutSecs,
		Workspace:    workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("set inference route %q in workspace %q: %w", routeName, workspace, err)
	}
	return resp, nil
}

// GetInferenceRoute fetches the configured route for a workspace.
func (c *Client) GetInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.GetInferenceRouteResponse, error) {
	resp, err := c.inference.GetInferenceRoute(ctx, &inferencev1.GetInferenceRouteRequest{
		RouteName: routeName,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get inference route %q in workspace %q: %w", routeName, workspace, err)
	}
	return resp, nil
}

// DeleteInferenceRoute removes a route from a workspace.
func (c *Client) DeleteInferenceRoute(ctx context.Context, workspace, routeName string) (*inferencev1.DeleteInferenceRouteResponse, error) {
	resp, err := c.inference.DeleteInferenceRoute(ctx, &inferencev1.DeleteInferenceRouteRequest{
		RouteName: routeName,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("delete inference route %q in workspace %q: %w", routeName, workspace, err)
	}
	return resp, nil
}
