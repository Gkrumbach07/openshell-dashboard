// Package services is the business-logic layer for all operations
package services

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend/pkg/models"
	openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
)

// GatewayServiceInterface is the contract GatewayHandler depends on. Downstream can satisfy
// it with its own type, or embed Service and shadow individual methods to
// layer custom logic on top of the upstream default.
//
// CheckHealth and GetCurrentUser cover the SDK's HealthInterface
// (client.Health()); GetGatewayInfo also doubles as
// HealthInterface.GetGatewayInfo.
type GatewayServiceInterface interface {
	GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error)
	CheckHealth(ctx context.Context) (*models.HealthInfo, error)
	GetCurrentUser(ctx context.Context) (*models.CurrentUser, error)
}

type GatewayService struct {
	// clients openshell.Factory
	sdk openshell.ClientInterface
}

// NewService builds the default upstream implementation. clients mints an
// OpenShell SDK client per request (see pkg/clients/openshell).
func NewGatewayService(sdk openshell.ClientInterface) *GatewayService {
	return &GatewayService{sdk: sdk}
}

func (s *GatewayService) GetGatewayInfo(ctx context.Context) (*models.GatewayInfo, error) {
	info, err := s.sdk.Health().GetGatewayInfo(ctx)
	if err != nil {
		return nil, err
	}
	result := models.FromSDKGatewayInfo(info)
	return &result, nil
}

func (s *GatewayService) CheckHealth(ctx context.Context) (*models.HealthInfo, error) {
	health, err := s.sdk.Health().Check(ctx)
	if err != nil {
		return nil, err
	}
	return &models.HealthInfo{HealthResult: health}, nil
}

func (s *GatewayService) GetCurrentUser(ctx context.Context) (*models.CurrentUser, error) {
	info, err := s.sdk.Health().GetCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	result := models.FromSDKCurrentUser(info)
	return &result, nil
}
