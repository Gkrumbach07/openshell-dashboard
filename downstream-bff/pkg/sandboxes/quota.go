package sandboxes

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/models"
	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

// ErrQuotaExceeded is returned (wrapped) when a workspace is at its limit.
// A sentinel error, not a string match, so callers (the handler) can tell
// "quota" apart from "upstream/gateway failure" via errors.Is.
var ErrQuotaExceeded = errors.New("sandbox quota exceeded")

// QuotaEnforcer decorates a sandbox.Service with a per-workspace count
// limit — a feature backend-v2 has no concept of. It embeds sandbox.Service
// (upstream's interface, by value) directly: GetSandbox and ListSandboxes
// are inherited unmodified, and so is anything Service gains later (same
// additive-safety property as backend-v2/examples/audit).
type QuotaEnforcer struct {
	sandbox.Service
	limit int

	mu     sync.Mutex
	counts map[string]int // workspace -> active sandbox count
}

// NewQuotaEnforcer wraps base with a per-workspace limit on sandbox count.
func NewQuotaEnforcer(base sandbox.Service, limit int) *QuotaEnforcer {
	return &QuotaEnforcer{
		Service: base,
		limit:   limit,
		counts:  make(map[string]int),
	}
}

func (q *QuotaEnforcer) CreateSandbox(ctx context.Context, workspace string, req models.CreateSandboxRequest) (*models.Sandbox, error) {
	q.mu.Lock()
	if q.counts[workspace] >= q.limit {
		q.mu.Unlock()
		return nil, fmt.Errorf("%w: workspace %q already has %d sandboxes (limit %d)", ErrQuotaExceeded, workspace, q.counts[workspace], q.limit)
	}
	q.mu.Unlock()

	sb, err := q.Service.CreateSandbox(ctx, workspace, req) // delegate to upstream
	if err != nil {
		return nil, err
	}

	q.mu.Lock()
	q.counts[workspace]++
	q.mu.Unlock()
	return sb, nil
}

func (q *QuotaEnforcer) DeleteSandbox(ctx context.Context, workspace, name string) error {
	if err := q.Service.DeleteSandbox(ctx, workspace, name); err != nil {
		return err
	}
	q.mu.Lock()
	if q.counts[workspace] > 0 {
		q.counts[workspace]--
	}
	q.mu.Unlock()
	return nil
}

// Verify *QuotaEnforcer still satisfies sandbox.Service.
var _ sandbox.Service = (*QuotaEnforcer)(nil)
