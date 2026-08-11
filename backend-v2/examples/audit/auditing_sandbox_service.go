// Package audit is an in-process worked example of decorating this BFF's
// Sandbox service without forking it: it adds audit logging around
// Create/Delete while every other method (Get, List) falls through
// untouched to the upstream default implementation. It lives in the same
// module as sandbox.Service, unlike backend-v2/../downstream-bff, which is
// a genuinely separate consumer module — see that module's README for the
// anti-corruption-layer version of this same idea, which is what you'd
// actually want once the "downstream" is a different team/repo instead of
// the same codebase.
//
// This is the payoff of embedding the interface directly: no separate
// "Decorator" wrapper type to learn. Embedding the interface itself (not a
// wrapper struct) is what makes this robust to upstream adding methods to
// Service later: Go promotes methods from an embedded interface field
// dynamically, so a method this file never mentions is still forwarded
// correctly. See the compatibility contract on sandbox.Service for the rule
// that makes that safe (upstream only ever adds to Service, never
// changes/removes).
package audit

import (
	"context"
	"log/slog"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

// AuditingSandboxService wraps a base sandbox.Service and logs create/delete
// calls. GetSandbox and ListSandboxes — and any method sandbox.Service gains
// in the future — are inherited unmodified via the embedded Service.
type AuditingSandboxService struct {
	sandbox.Service // embed the interface directly, no wrapper type
	logger          *slog.Logger
}

// NewAuditingSandboxService decorates base with audit logging.
func NewAuditingSandboxService(base sandbox.Service, logger *slog.Logger) *AuditingSandboxService {
	return &AuditingSandboxService{
		Service: base,
		logger:  logger,
	}
}

// CreateSandbox overrides the base method: delegate, then audit-log.
func (a *AuditingSandboxService) CreateSandbox(ctx context.Context, workspace string, req models.CreateSandboxRequest) (*models.Sandbox, error) {
	sb, err := a.Service.CreateSandbox(ctx, workspace, req) // delegate to wrapped Service
	a.logger.Info("audit: sandbox.create", "workspace", workspace, "name", req.Name, "error", err)
	return sb, err
}

// DeleteSandbox overrides the base method: audit-log, then delegate.
func (a *AuditingSandboxService) DeleteSandbox(ctx context.Context, workspace, name string) error {
	a.logger.Info("audit: sandbox.delete", "workspace", workspace, "name", name)
	return a.Service.DeleteSandbox(ctx, workspace, name)
}

// Verify *AuditingSandboxService still satisfies sandbox.Service — the
// point of the pattern: handlers never know this decorator exists.
var _ sandbox.Service = (*AuditingSandboxService)(nil)
