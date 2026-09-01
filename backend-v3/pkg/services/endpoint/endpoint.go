// Package endpoint is the business-logic layer for exposing sandbox ports
// as named, externally reachable service endpoints. Mirrors the SDK's
// ServiceInterface (client.Services()) --
// https://ro14nd.de/openshell-sdk-go/api/services.html. Named "endpoint"
// rather than "service" to avoid colliding with this project's own
// service-layer terminology (pkg/services/...).
package endpoint

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract EndpointHandler depends on.
type Service interface {
	// Expose exposes a sandbox port as a named service endpoint. Set
	// domain to assign a DNS-routable domain name.
	Expose(ctx context.Context, workspace, sandboxName, serviceName string, targetPort uint32, domain bool) (*models.ServiceEndpoint, error)
	Get(ctx context.Context, workspace, sandboxName, serviceName string) (*models.ServiceEndpoint, error)
	List(ctx context.Context, workspace, sandboxName string) ([]*models.ServiceEndpoint, error)
	Delete(ctx context.Context, workspace, sandboxName, serviceName string) error
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) Expose(ctx context.Context, workspace, sandboxName, serviceName string, targetPort uint32, domain bool) (*models.ServiceEndpoint, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ExposeService(ctx, workspace, sandboxName, serviceName, targetPort, domain)
}

func (s *service) Get(ctx context.Context, workspace, sandboxName, serviceName string) (*models.ServiceEndpoint, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetService(ctx, workspace, sandboxName, serviceName)
}

func (s *service) List(ctx context.Context, workspace, sandboxName string) ([]*models.ServiceEndpoint, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.ListServices(ctx, workspace, sandboxName)
}

func (s *service) Delete(ctx context.Context, workspace, sandboxName, serviceName string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DeleteService(ctx, workspace, sandboxName, serviceName)
}
