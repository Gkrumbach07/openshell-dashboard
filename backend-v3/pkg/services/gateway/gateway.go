// Package gateway is the business-logic layer for gateway-wide operations
// (info, health, current-user identity). It defines Service as a public
// interface with an unexported default implementation, so downstream can
// depend on gateway.Service without ever touching gateway.service directly
// -- interface decoration, not struct embedding.
package gateway

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract GatewayHandler depends on. Downstream can satisfy
// it with its own type, or embed Service and shadow individual methods to
// layer custom logic on top of the upstream default.
//
// CheckHealth and GetCurrentUser cover the SDK's HealthInterface
// (client.Health()); GetGatewayInfo also doubles as
// HealthInterface.GetGatewayInfo.
type Service interface {
	GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error)
	CheckHealth(ctx context.Context) (*models.HealthResult, error)
	GetCurrentUser(ctx context.Context) (*models.CurrentUser, error)
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation. clients mints an
// OpenShell SDK client per request (see pkg/clients/openshell).
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetGatewayInfo(ctx)
}

func (s *service) CheckHealth(ctx context.Context) (*models.HealthResult, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.CheckHealth(ctx)
}

func (s *service) GetCurrentUser(ctx context.Context) (*models.CurrentUser, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetCurrentUser(ctx)
}
