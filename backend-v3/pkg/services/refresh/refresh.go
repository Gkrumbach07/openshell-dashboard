// Package refresh is the business-logic layer for provider credential
// refresh schedules. Mirrors the SDK's RefreshInterface
// (client.Providers().Refresh()) --
// https://ro14nd.de/openshell-sdk-go/api/refresh.html.
package refresh

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract RefreshHandler depends on.
type Service interface {
	GetStatus(ctx context.Context, workspace, provider, credentialKey string) ([]*models.RefreshStatus, error)
	// Configure sets up automatic credential refresh with a strategy and
	// material (e.g. OAuth2 client credentials).
	Configure(ctx context.Context, workspace string, config *models.RefreshConfig) (*models.RefreshStatus, error)
	// Rotate manually triggers an immediate credential rotation.
	Rotate(ctx context.Context, workspace, provider, credentialKey string) (*models.RefreshStatus, error)
	Delete(ctx context.Context, workspace, provider, credentialKey string) (bool, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) GetStatus(ctx context.Context, workspace, provider, credentialKey string) ([]*models.RefreshStatus, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetRefreshStatus(ctx, workspace, provider, credentialKey)
}

func (s *service) Configure(ctx context.Context, workspace string, config *models.RefreshConfig) (*models.RefreshStatus, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ConfigureRefresh(ctx, workspace, config)
}

func (s *service) Rotate(ctx context.Context, workspace, provider, credentialKey string) (*models.RefreshStatus, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.RotateRefresh(ctx, workspace, provider, credentialKey)
}

func (s *service) Delete(ctx context.Context, workspace, provider, credentialKey string) (bool, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return false, err
	}
	return client.DeleteRefresh(ctx, workspace, provider, credentialKey)
}
