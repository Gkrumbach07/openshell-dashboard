// Package sandbox is the business-logic layer for sandbox operations.
// Sandbox is the fundamental unit of the upstream OpenShell API -- there is
// no separate "Agent" abstraction layered on top of it here.
package sandbox

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract SandboxHandler depends on. Method set mirrors the
// SDK's SandboxInterface (client.Sandboxes()) one-for-one; Watch is handled
// separately at the client/handler layer (see openshell.Client.WatchSandbox
// and SandboxHandler.WatchSandbox) since it's a stream, not a request/reply
// call.
type Service interface {
	GetSandbox(ctx context.Context, workspace, name string) (*models.Sandbox, error)
	ListSandboxes(ctx context.Context, workspace string) ([]*models.Sandbox, error)
	CreateSandbox(ctx context.Context, workspace, name string, spec *models.SandboxSpec, labels map[string]string) (*models.Sandbox, error)
	DeleteSandbox(ctx context.Context, workspace, name string) error
	AttachProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.AttachProviderResult, error)
	DetachProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.DetachProviderResult, error)
	ListProviders(ctx context.Context, workspace, sandboxName string) ([]*models.Provider, error)
	WaitReady(ctx context.Context, workspace, name string) (*models.Sandbox, error)
	GetLogs(ctx context.Context, workspace, sandboxName string, opts models.LogOptions) (*models.LogResult, error)
	// Watch streams state-change events for a sandbox until ctx is
	// cancelled or the returned stop func is called.
	Watch(ctx context.Context, workspace, name string) (<-chan *models.SandboxEvent, func(), error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) GetSandbox(ctx context.Context, workspace, name string) (*models.Sandbox, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetSandbox(ctx, workspace, name)
}

func (s *service) ListSandboxes(ctx context.Context, workspace string) ([]*models.Sandbox, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListSandboxes(ctx, workspace)
}

func (s *service) CreateSandbox(ctx context.Context, workspace, name string, spec *models.SandboxSpec, labels map[string]string) (*models.Sandbox, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.CreateSandbox(ctx, workspace, name, spec, labels)
}

func (s *service) DeleteSandbox(ctx context.Context, workspace, name string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DeleteSandbox(ctx, workspace, name)
}

func (s *service) AttachProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.AttachProviderResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.AttachSandboxProvider(ctx, workspace, sandboxName, providerName, expectedResourceVersion)
}

func (s *service) DetachProvider(ctx context.Context, workspace, sandboxName, providerName string, expectedResourceVersion uint64) (*models.DetachProviderResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.DetachSandboxProvider(ctx, workspace, sandboxName, providerName, expectedResourceVersion)
}

func (s *service) ListProviders(ctx context.Context, workspace, sandboxName string) ([]*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListSandboxProviders(ctx, workspace, sandboxName)
}

func (s *service) WaitReady(ctx context.Context, workspace, name string) (*models.Sandbox, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.WaitSandboxReady(ctx, workspace, name)
}

func (s *service) GetLogs(ctx context.Context, workspace, sandboxName string, opts models.LogOptions) (*models.LogResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetSandboxLogs(ctx, workspace, sandboxName, opts)
}

func (s *service) Watch(ctx context.Context, workspace, name string) (<-chan *models.SandboxEvent, func(), error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, nil, err
	}
	return client.WatchSandbox(ctx, workspace, name)
}
