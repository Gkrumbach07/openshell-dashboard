// Package workspace is the business-logic layer for workspace lifecycle and
// membership. Mirrors the SDK's WorkspaceInterface (client.Workspaces()).
// This is Platform-Admin-only surface (see CLAUDE.md personas):
// cross-workspace management, unlike every other domain in pkg/services
// which is scoped to a single workspace.
package workspace

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract WorkspaceHandler depends on.
type Service interface {
	Create(ctx context.Context, name string, labels map[string]string) (*models.Workspace, error)
	Get(ctx context.Context, name string) (*models.Workspace, error)
	List(ctx context.Context, opts models.ListOptions) ([]*models.Workspace, error)
	Delete(ctx context.Context, name string) error
	AddMember(ctx context.Context, workspace, principalSubject, role string) (*models.WorkspaceMember, error)
	RemoveMember(ctx context.Context, workspace, principalSubject string) error
	ListMembers(ctx context.Context, workspace string) ([]*models.WorkspaceMember, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Create(ctx context.Context, name string, labels map[string]string) (*models.Workspace, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.CreateWorkspace(ctx, name, labels)
}

func (s *service) Get(ctx context.Context, name string) (*models.Workspace, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetWorkspace(ctx, name)
}

func (s *service) List(ctx context.Context, opts models.ListOptions) ([]*models.Workspace, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListWorkspaces(ctx, opts)
}

func (s *service) Delete(ctx context.Context, name string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DeleteWorkspace(ctx, name)
}

func (s *service) AddMember(ctx context.Context, workspace, principalSubject, role string) (*models.WorkspaceMember, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.AddWorkspaceMember(ctx, workspace, principalSubject, role)
}

func (s *service) RemoveMember(ctx context.Context, workspace, principalSubject string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.RemoveWorkspaceMember(ctx, workspace, principalSubject)
}

func (s *service) ListMembers(ctx context.Context, workspace string) ([]*models.WorkspaceMember, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListWorkspaceMembers(ctx, workspace)
}
