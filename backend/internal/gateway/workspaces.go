package gateway

import (
	"context"
	"fmt"

	datamodelv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/datamodelv1"
	openshellv1 "github.com/Gkrumbach07/openshell-dashboard/backend/gen/openshellv1"
)

// CreateWorkspace creates a workspace. Name must be a valid DNS-1123 label.
func (c *Client) CreateWorkspace(ctx context.Context, name string, labels map[string]string) (*datamodelv1.Workspace, error) {
	resp, err := c.openshell.CreateWorkspace(ctx, &openshellv1.CreateWorkspaceRequest{
		Name:   name,
		Labels: labels,
	})
	if err != nil {
		return nil, fmt.Errorf("create workspace %q: %w", name, err)
	}
	return resp.Workspace, nil
}

// GetWorkspace fetches a workspace by name.
func (c *Client) GetWorkspace(ctx context.Context, name string) (*datamodelv1.Workspace, error) {
	resp, err := c.openshell.GetWorkspace(ctx, &openshellv1.GetWorkspaceRequest{Name: name})
	if err != nil {
		return nil, fmt.Errorf("get workspace %q: %w", name, err)
	}
	return resp.Workspace, nil
}

// ListWorkspaces lists workspaces.
func (c *Client) ListWorkspaces(ctx context.Context, limit, offset uint32, labelSelector string) ([]*datamodelv1.Workspace, error) {
	resp, err := c.openshell.ListWorkspaces(ctx, &openshellv1.ListWorkspacesRequest{
		Limit:         limit,
		Offset:        offset,
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	return resp.Workspaces, nil
}

// DeleteWorkspace deletes a workspace by name.
func (c *Client) DeleteWorkspace(ctx context.Context, name string) (bool, error) {
	resp, err := c.openshell.DeleteWorkspace(ctx, &openshellv1.DeleteWorkspaceRequest{Name: name})
	if err != nil {
		return false, fmt.Errorf("delete workspace %q: %w", name, err)
	}
	return resp.Deleted, nil
}

// AddWorkspaceMember adds a member (OIDC subject + role) to a workspace.
// There is no role-update RPC — a role change is remove + re-add.
func (c *Client) AddWorkspaceMember(ctx context.Context, workspace, principalSubject string, role openshellv1.WorkspaceRole) (*openshellv1.WorkspaceMember, error) {
	resp, err := c.openshell.AddWorkspaceMember(ctx, &openshellv1.AddWorkspaceMemberRequest{
		Workspace:        workspace,
		PrincipalSubject: principalSubject,
		Role:             role,
	})
	if err != nil {
		return nil, fmt.Errorf("add member %q to workspace %q: %w", principalSubject, workspace, err)
	}
	return resp.Member, nil
}

// RemoveWorkspaceMember removes a member from a workspace.
func (c *Client) RemoveWorkspaceMember(ctx context.Context, workspace, principalSubject string) (bool, error) {
	resp, err := c.openshell.RemoveWorkspaceMember(ctx, &openshellv1.RemoveWorkspaceMemberRequest{
		Workspace:        workspace,
		PrincipalSubject: principalSubject,
	})
	if err != nil {
		return false, fmt.Errorf("remove member %q from workspace %q: %w", principalSubject, workspace, err)
	}
	return resp.Removed, nil
}

// ListWorkspaceMembers lists members of a workspace.
func (c *Client) ListWorkspaceMembers(ctx context.Context, workspace string, limit, offset uint32) ([]*openshellv1.WorkspaceMember, error) {
	resp, err := c.openshell.ListWorkspaceMembers(ctx, &openshellv1.ListWorkspaceMembersRequest{
		Workspace: workspace,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		return nil, fmt.Errorf("list members in workspace %q: %w", workspace, err)
	}
	return resp.Members, nil
}
