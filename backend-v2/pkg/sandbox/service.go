// Package sandbox is the Sandbox bounded context, package-based per the
// migration strategy doc: service and HTTP handler live together here since
// they're one component from a consumer's point of view. Only pkg/models
// (shared DTOs, to avoid circular imports) and pkg/httpx (shared HTTP infra)
// are split out.
//
//   - Service is a public interface — the only thing the handler or
//     downstream code should depend on.
//   - service is the private default implementation. It cannot be
//     constructed or type-asserted to from outside this package, so nothing
//     can accidentally depend on implementation details instead of Service.
//   - NewService is the public constructor, returning Service (not *service).
//
// Downstream decorates by embedding Service directly — no separate
// Decorator type needed (see backend-v2/examples/audit). See the
// compatibility contract on Service below for how that stays safe as this
// interface evolves.
package sandbox

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/gateway"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
)

// Service is the Sandbox business-logic interface. Handlers depend on this,
// never on the concrete type.
//
// Compatibility contract: this interface is append-only. Methods are never
// removed or have their signature changed — only added. That's what lets
// downstream code that embeds Service by value (see examples/audit)
// keep compiling across upstream changes with zero edits: Go promotes
// methods from an embedded interface field dynamically, so a newly added
// method is automatically available (forwarded to whatever concrete Service
// was passed in) even though it didn't exist when the downstream type was
// written. If a change can't be made additively, it belongs on a new
// interface (e.g. ServiceV2) rather than a breaking edit here.
type Service interface {
	CreateSandbox(ctx context.Context, workspace string, req models.CreateSandboxRequest) (*models.Sandbox, error)
	GetSandbox(ctx context.Context, workspace, name string) (*models.Sandbox, error)
	ListSandboxes(ctx context.Context, workspace string) ([]models.Sandbox, error)
	DeleteSandbox(ctx context.Context, workspace, name string) error
}

// service is the default implementation. Unexported: callers outside this
// package can only hold a Service, never reach into service-specific fields.
type service struct {
	gw gateway.Interface
}

// NewService builds the default Sandbox service backed by gw — the shared
// gateway client/mock SDK connection (see pkg/gateway.Interface).
func NewService(gw gateway.Interface) Service {
	return &service{gw: gw}
}

func (s *service) CreateSandbox(ctx context.Context, workspace string, req models.CreateSandboxRequest) (*models.Sandbox, error) {
	rec, err := s.gw.CreateSandbox(ctx, workspace, req.Name, req.Image, req.Labels)
	if err != nil {
		return nil, err
	}
	return fromRecord(rec), nil
}

func (s *service) GetSandbox(ctx context.Context, workspace, name string) (*models.Sandbox, error) {
	rec, err := s.gw.GetSandbox(ctx, workspace, name)
	if err != nil {
		return nil, err
	}
	return fromRecord(rec), nil
}

func (s *service) ListSandboxes(ctx context.Context, workspace string) ([]models.Sandbox, error) {
	recs, err := s.gw.ListSandboxes(ctx, workspace)
	if err != nil {
		return nil, err
	}
	out := make([]models.Sandbox, 0, len(recs))
	for _, rec := range recs {
		out = append(out, *fromRecord(rec))
	}
	return out, nil
}

func (s *service) DeleteSandbox(ctx context.Context, workspace, name string) error {
	return s.gw.DeleteSandbox(ctx, workspace, name)
}

func fromRecord(rec *gateway.SandboxRecord) *models.Sandbox {
	return &models.Sandbox{
		Name:      rec.Name,
		Workspace: rec.Workspace,
		Image:     rec.Image,
		Phase:     rec.Phase,
		Labels:    rec.Labels,
	}
}

// Verify *service implements Service at compile time.
var _ Service = (*service)(nil)
