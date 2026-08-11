package sandboxes

import (
	"context"

	"github.com/Gkrumbach07/openshell-dashboard/backend-v2/pkg/sandbox"
)

// ExtendedService is this BFF's OWN interface: everything upstream's
// sandbox.Service provides, plus RestartSandbox — a capability backend-v2
// has no concept of and will never define, because it isn't upstream's
// concern. This is exactly the case where defining a local interface earns
// its keep (unlike the removed pkg/provisioning ACL): downstream needs a
// method that doesn't exist on the type it's decorating, so it declares a
// superset interface and implements the new part itself.
//
// Handlers that need the new capability depend on ExtendedService, not
// sandbox.Service — see handler.go. A handler that only needs what
// upstream already provides (see how Provider is wired in cmd/api/main.go,
// no local interface at all) should keep depending on sandbox.Service or
// even backend-v2's own handler directly.
type ExtendedService interface {
	sandbox.Service
	RestartSandbox(ctx context.Context, workspace, name string) error
}
