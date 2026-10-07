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
	CheckHealth(ctx context.Context) error
	GetCurrentUser(ctx context.Context) (*models.CurrentUser, error)
}

// GatewayVersionReader reads the gateway's version without needing a role.
//
// GetGatewayInfo also returns the version, but the gateway answers that RPC
// only for platform admins (its proto declares global_role "platform_admin").
// The health check carries the same version string and is declared
// "unauthenticated", so it is the one source every signed-in user can read.
//
// It is an interface of its own, rather than a method added to
// GatewayServiceInterface, so that a downstream type written against that
// interface keeps compiling. GatewayHandler uses it when the service has it —
// GatewayService does — and falls back to GetGatewayInfo when it does not.
type GatewayVersionReader interface {
	GetGatewayVersion(ctx context.Context) (string, error)
}

// GatewayHealthReader reads the whole answer of the gateway's health check:
// the version GatewayVersionReader returns, and whether the gateway called
// itself healthy. It is one call, so a handler that wants both asks here.
//
// Like GatewayVersionReader it is an interface of its own so that a downstream
// service written before it existed keeps compiling. GatewayHandler prefers it
// and falls back to GatewayVersionReader, which reports no health.
type GatewayHealthReader interface {
	GetGatewayHealth(ctx context.Context) (*models.GatewayHealth, error)
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

func (s *GatewayService) CheckHealth(ctx context.Context) error {
	_, err := s.sdk.Health().Check(ctx)
	return err
}

// GetGatewayVersion returns the version the gateway's health check reports.
// It is the same call CheckHealth makes, keeping the half of the answer that
// CheckHealth drops.
func (s *GatewayService) GetGatewayVersion(ctx context.Context) (string, error) {
	result, err := s.sdk.Health().Check(ctx)
	if err != nil {
		return "", err
	}
	if result == nil {
		return "", nil
	}
	return result.Version, nil
}

// GetGatewayHealth returns what the gateway's health check reports: the same
// call again, this time keeping both halves of the answer. A nil result means
// the SDK answered with nothing, so there is neither a version nor a health
// to pass on.
func (s *GatewayService) GetGatewayHealth(ctx context.Context) (*models.GatewayHealth, error) {
	result, err := s.sdk.Health().Check(ctx)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}
	return &models.GatewayHealth{Version: result.Version, Healthy: result.Healthy}, nil
}

func (s *GatewayService) GetCurrentUser(ctx context.Context) (*models.CurrentUser, error) {
	info, err := s.sdk.Health().GetCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	result := models.FromSDKCurrentUser(info)
	return &result, nil
}
