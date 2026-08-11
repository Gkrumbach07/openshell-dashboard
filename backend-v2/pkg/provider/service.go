// Package provider is the Provider bounded context. Mirrors pkg/sandbox's
// shape exactly (service + handler, package-based) — that repetition is
// intentional: it's the template Policy, Inference, and Observability would
// follow next.
package provider

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
)

// Service is the Provider business-logic interface.
//
// Compatibility contract: append-only, same as sandbox.Service — see the
// doc comment there for why that's what keeps downstream decorators
// compiling across interface growth.
type Service interface {
	CreateProvider(ctx context.Context, workspace string, req models.CreateProviderRequest) (*models.Provider, error)
	GetProvider(ctx context.Context, workspace, name string) (*models.Provider, error)
	ListProviders(ctx context.Context, workspace string) ([]models.Provider, error)
	DeleteProvider(ctx context.Context, workspace, name string) error
}

// service is the private default implementation.
type service struct {
	gw gateway.Interface
}

// NewService builds the default Provider service backed by gw — the same
// shared gateway client/mock SDK connection sandbox.NewService takes.
func NewService(gw gateway.Interface) Service {
	return &service{gw: gw}
}

func (s *service) CreateProvider(ctx context.Context, workspace string, req models.CreateProviderRequest) (*models.Provider, error) {
	rec, err := s.gw.CreateProvider(ctx, workspace, req.Name, req.Type, req.Config)
	if err != nil {
		return nil, err
	}
	return fromRecord(rec), nil
}

func (s *service) GetProvider(ctx context.Context, workspace, name string) (*models.Provider, error) {
	rec, err := s.gw.GetProvider(ctx, workspace, name)
	if err != nil {
		return nil, err
	}
	return fromRecord(rec), nil
}

func (s *service) ListProviders(ctx context.Context, workspace string) ([]models.Provider, error) {
	recs, err := s.gw.ListProviders(ctx, workspace)
	if err != nil {
		return nil, err
	}
	out := make([]models.Provider, 0, len(recs))
	for _, rec := range recs {
		out = append(out, *fromRecord(rec))
	}
	return out, nil
}

func (s *service) DeleteProvider(ctx context.Context, workspace, name string) error {
	return s.gw.DeleteProvider(ctx, workspace, name)
}

func fromRecord(rec *gateway.ProviderRecord) *models.Provider {
	return &models.Provider{
		Name:            rec.Name,
		Workspace:       rec.Workspace,
		Type:            rec.Type,
		Config:          rec.Config,
		CredentialNames: rec.CredentialNames,
	}
}

// Verify *service implements Service at compile time.
var _ Service = (*service)(nil)
