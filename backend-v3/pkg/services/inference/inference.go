// Package inference is the business-logic layer for workspace inference
// routes (forcing a provider/model for generation calls). Mirrors the
// SDK's InferenceInterface (client.Inference()).
package inference

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/clients/openshell"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v3/pkg/models"
)

// Service is the contract InferenceHandler depends on.
type Service interface {
	// SetRoute configures an inference route for a workspace.
	SetRoute(ctx context.Context, workspace string, config *models.InferenceRouteConfig) (*models.InferenceRoute, error)
	// GetRoute retrieves the inference route for a workspace by route
	// name. An empty routeName represents the default user-facing route.
	GetRoute(ctx context.Context, workspace, routeName string) (*models.InferenceRoute, error)
	// DeleteRoute removes an inference route. Idempotent: deleting a
	// non-existent route is not an error.
	DeleteRoute(ctx context.Context, workspace, routeName string) error
}

type service struct {
	clients openshell.Factory
}

// NewService builds the default upstream implementation.
func NewService(clients openshell.Factory) Service {
	return &service{clients: clients}
}

func (s *service) SetRoute(ctx context.Context, workspace string, config *models.InferenceRouteConfig) (*models.InferenceRoute, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.SetInferenceRoute(ctx, workspace, config)
}

func (s *service) GetRoute(ctx context.Context, workspace, routeName string) (*models.InferenceRoute, error) {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return client.GetInferenceRoute(ctx, workspace, routeName)
}

func (s *service) DeleteRoute(ctx context.Context, workspace, routeName string) error {
	client, err := s.clients.NewClient(ctx)
	if err != nil {
		return err
	}
	return client.DeleteInferenceRoute(ctx, workspace, routeName)
}
