// Package profile is the business-logic layer for provider profiles
// (templates and defaults for provider types like "openai", "anthropic").
// Mirrors the SDK's ProfileInterface (client.Providers().Profiles()) --
// https://ro14nd.de/openshell-sdk-go/api/profiles.html.
package profile

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract ProfileHandler depends on.
type Service interface {
	List(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.ProviderProfile, error)
	Get(ctx context.Context, workspace, id string) (*models.ProviderProfile, error)
	Import(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.ImportResult, error)
	// Update uses optimistic concurrency control via expectedResourceVersion.
	Update(ctx context.Context, workspace, id string, expectedResourceVersion uint64, item models.ProfileImportItem) (*models.UpdateResult, error)
	// Lint validates profile configurations without persisting them.
	Lint(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.LintResult, error)
	Delete(ctx context.Context, workspace, id string) (bool, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) List(ctx context.Context, workspace string, opts models.ListOptions) ([]*models.ProviderProfile, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListProfiles(ctx, workspace, opts)
}

func (s *service) Get(ctx context.Context, workspace, id string) (*models.ProviderProfile, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetProfile(ctx, workspace, id)
}

func (s *service) Import(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.ImportResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ImportProfiles(ctx, workspace, items)
}

func (s *service) Update(ctx context.Context, workspace, id string, expectedResourceVersion uint64, item models.ProfileImportItem) (*models.UpdateResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.UpdateProfile(ctx, workspace, id, expectedResourceVersion, item)
}

func (s *service) Lint(ctx context.Context, workspace string, items []models.ProfileImportItem) (*models.LintResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.LintProfiles(ctx, workspace, items)
}

func (s *service) Delete(ctx context.Context, workspace, id string) (bool, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return false, err
	}
	return client.DeleteProfile(ctx, workspace, id)
}
