// Package gateway is the business-logic layer for gateway-wide operations
package gateway

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// Service is the contract GatewayHandler depends on. Downstream can satisfy
// it with its own type, or embed Service and shadow individual methods to
// layer custom logic on top of the upstream default.
//
// CheckHealth and GetCurrentUser cover the SDK's HealthInterface
// (client.Health()); GetGatewayInfo also doubles as
// HealthInterface.GetGatewayInfo.
type ServiceInterface interface {
	GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error)
	CheckHealth(ctx context.Context) (*models.HealthInfo, error)
	GetCurrentUser(ctx context.Context) (*models.CurrentUser, error)
}

type Service struct {
	// clients openshell.Factory
	sdk openshell.ClientInterface
}

// NewService builds the default upstream implementation. clients mints an
// OpenShell SDK client per request (see pkg/clients/openshell).
func NewService(sdk openshell.ClientInterface) *Service {
	return &Service{sdk: sdk}
}

func (s *Service) GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error) {
	info, err := s.sdk.Health().GetGatewayInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &models.GatewayInfo{GatewayInfo: info}, nil
}

func (s *Service) CheckHealth(ctx context.Context) (*models.HealthInfo, error) {
	health, err := s.sdk.Health().Check(ctx)
	if err != nil {
		return nil, err
	}
	return &models.HealthInfo{HealthResult: health}, nil
}

func (s *Service) GetCurrentUser(ctx context.Context) (*models.CurrentUser, error) {
	info, err := s.sdk.Health().GetCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	return &models.CurrentUser{CurrentUser: info}, nil
}
