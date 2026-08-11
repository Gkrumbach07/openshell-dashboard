package sandboxes

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

// restarter adds RestartSandbox on top of a base sandbox.Service — embedded
// by value, so GetSandbox/ListSandboxes/CreateSandbox/DeleteSandbox (and
// anything sandbox.Service gains later) are inherited unmodified, same
// technique as QuotaEnforcer. RestartSandbox itself is composed entirely
// from methods upstream already exposes (Get, Delete, Create) — no
// upstream API change was needed to add this feature.
type restarter struct {
	sandbox.Service
}

// NewRestarter adapts a base sandbox.Service into an ExtendedService by
// adding RestartSandbox. base is typically the already-quota-enforced
// service (see cmd/api/main.go) — decorators compose in any order as long
// as each stage's input type is what the previous stage returns.
func NewRestarter(base sandbox.Service) ExtendedService {
	return &restarter{Service: base}
}

func (r *restarter) RestartSandbox(ctx context.Context, workspace, name string) error {
	sb, err := r.GetSandbox(ctx, workspace, name)
	if err != nil {
		return err
	}
	if err := r.DeleteSandbox(ctx, workspace, name); err != nil {
		return err
	}
	_, err = r.CreateSandbox(ctx, workspace, models.CreateSandboxRequest{
		Name:  sb.Name,
		Image: sb.Image,
	})
	return err
}

// Verify *restarter satisfies ExtendedService.
var _ ExtendedService = (*restarter)(nil)
