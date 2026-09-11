// Package provider is the business-logic layer for compute/inference
// provider registrations. Mirrors the SDK's ProviderInterface
// (client.Providers()) -- https://ro14nd.de/openshell-sdk-go/api/providers.html.
// Sub-clients Profiles() and Refresh() are scaffolded as their own sibling
// packages (pkg/services/profile, pkg/services/refresh) rather than nested
// accessors, to stay consistent with this repo's flat service-per-domain
// convention.
package provider

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract ProviderHandler depends on.
type Service interface {
	Create(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
	Get(ctx context.Context, workspace, name string) (*models.Provider, error)
	List(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.Provider, error)
	Update(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
	Delete(ctx context.Context, workspace, name string) error
	// Ensure creates or updates a provider in a single idempotent call --
	// the recommended way to register providers.
	Ensure(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Create(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.CreateProvider(ctx, workspace, provider)
}

func (s *service) Get(ctx context.Context, workspace, name string) (*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetProvider(ctx, workspace, name)
}

func (s *service) List(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListProviders(ctx, workspace, opts)
}

func (s *service) Update(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.UpdateProvider(ctx, workspace, provider)
}

func (s *service) Delete(ctx context.Context, workspace, name string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DeleteProvider(ctx, workspace, name)
}

func (s *service) Ensure(ctx context.Context, workspace string, provider *models.Provider) (*models.Provider, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.EnsureProvider(ctx, workspace, provider)
}
