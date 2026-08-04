package gateway

import (
	"context"
	"fmt"

	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

func (c *Client) ExposeService(ctx context.Context, workspace, sandbox, service string, targetPort uint32, domain bool) (*openshellv1.ServiceEndpointResponse, error) {
	resp, err := c.openshell.ExposeService(ctx, &openshellv1.ExposeServiceRequest{
		Sandbox:    sandbox,
		Service:    service,
		TargetPort: targetPort,
		Domain:     domain,
		Workspace:  workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("expose service %q on sandbox %q in workspace %q: %w", service, sandbox, workspace, err)
	}
	return resp, nil
}

func (c *Client) ListServices(ctx context.Context, workspace, sandbox string) ([]*openshellv1.ServiceEndpointResponse, error) {
	resp, err := c.openshell.ListServices(ctx, &openshellv1.ListServicesRequest{
		Sandbox:   sandbox,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("list services for sandbox %q in workspace %q: %w", sandbox, workspace, err)
	}
	return resp.Services, nil
}

func (c *Client) GetService(ctx context.Context, workspace, sandbox, service string) (*openshellv1.ServiceEndpointResponse, error) {
	resp, err := c.openshell.GetService(ctx, &openshellv1.GetServiceRequest{
		Sandbox:   sandbox,
		Service:   service,
		Workspace: workspace,
	})
	if err != nil {
		return nil, fmt.Errorf("get service %q on sandbox %q in workspace %q: %w", service, sandbox, workspace, err)
	}
	return resp, nil
}

func (c *Client) DeleteService(ctx context.Context, workspace, sandbox, service string) (bool, error) {
	resp, err := c.openshell.DeleteService(ctx, &openshellv1.DeleteServiceRequest{
		Sandbox:   sandbox,
		Service:   service,
		Workspace: workspace,
	})
	if err != nil {
		return false, fmt.Errorf("delete service %q on sandbox %q in workspace %q: %w", service, sandbox, workspace, err)
	}
	return resp.Deleted, nil
}
