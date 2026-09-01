// Package config is the business-logic layer for sandbox and gateway
// configuration. Mirrors the SDK's ConfigInterface (client.Config()) --
// https://ro14nd.de/openshell-sdk-go/api/config.html.
package config

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract ConfigHandler depends on.
type Service interface {
	GetSandboxConfig(ctx context.Context, workspace, sandboxName string) (*models.SandboxConfig, error)
	GetGatewayConfig(ctx context.Context) (*models.GatewayConfig, error)
	// Update applies a validated configuration mutation, sandbox- or
	// gateway-scoped depending on update.Global.
	Update(ctx context.Context, workspace string, update *models.ConfigUpdate) (*models.ConfigUpdateResult, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) GetSandboxConfig(ctx context.Context, workspace, sandboxName string) (*models.SandboxConfig, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetSandboxConfig(ctx, workspace, sandboxName)
}

func (s *service) GetGatewayConfig(ctx context.Context) (*models.GatewayConfig, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetGatewayConfig(ctx)
}

func (s *service) Update(ctx context.Context, workspace string, update *models.ConfigUpdate) (*models.ConfigUpdateResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.UpdateConfig(ctx, workspace, update)
}
