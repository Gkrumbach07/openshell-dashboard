# downstream-bff — a real, separate consumer of backend-v2

**WARNING: VIBECODED. ONLY FOR DEMONSTRATION PURPOSES**

## To test

```
go run cmd/api
```

Making requests to `localhost:8081` with any Bearer Token auth will work.

- `POST localhost:8081/api/v1/workspaces/test/sandboxes/wow/restart`
  - This is one of the example routes that is an extra implementation in downstream, but doesn't exist in upstream.

## Description

This is what "downstream reuses the BFF" looks like when downstream is a
genuinely different Go module (different repo/team in a real setup), not
just a package inside `backend-v2`. It's a second, independently
deployable BFF that depends on `backend-v2` as a library.

Standalone Go module — see "Building this right now" below for why it
builds without `backend-v2` being published anywhere yet.

## What it does differently from backend-v2

- **Sandbox**: adds a per-workspace sandbox quota (`SANDBOX_QUOTA_PER_WORKSPACE`,
  default 2, `pkg/sandboxes.QuotaEnforcer`) AND a `RestartSandbox` capability
  that doesn't exist on backend-v2 at all (`pkg/sandboxes.ExtendedService` /
  `NewRestarter`) — exposed as `POST .../sandboxes/{name}/restart`.
- **Provider**: no customization; reuses `backend-v2/pkg/provider.NewProviderHandler`
  directly — no local package for it at all.
- **Auth**: none — reuses `backend-v2/pkg/auth` wholesale. Same relay model,
  same middleware, zero reimplementation.
- **Gateway**: reuses `backend-v2/pkg/gateway.Fake` wholesale for the demo;
  a real deployment would construct a real gRPC client the same way
  backend-v2's own `cmd/api/main.go` would.

## Two consumption patterns, side by side

**Provider — reuse upstream's handler unmodified.** No local package, no
local interface:

```go
// cmd/api/main.go
providerService := upstreamprovider.NewService(gw)
providerHandler := upstreamprovider.NewProviderHandler(base, providerService)
```

This is the default: if a domain needs no new capability and no behavior
change, there's nothing to write. Reuse backend-v2's exported
`Service`/`Handler` pair as-is.

**Sandbox — rewritten handler, because it needs a method upstream doesn't
have.** `RestartSandbox` isn't part of `backend-v2/pkg/sandbox.Service` and
never will be — it's not upstream's concern. So this BFF declares its own
superset interface (`pkg/sandboxes/restart.go`):

```go
type ExtendedService interface {
    sandbox.Service          // embeds upstream's interface — inherits its 4 methods
    RestartSandbox(ctx context.Context, workspace, name string) error
}
```

`restarter` implements the new method by composing upstream's *existing*
methods (`Get` → `Delete` → `Create`) — no upstream API change was needed
to add this feature at all. `pkg/sandboxes/handler.go` depends on
`ExtendedService`, not `sandbox.Service`, and registers one extra route
(`/restart`) that calls the new method. This is *why* the handler had to be
rewritten rather than reused: `backend-v2.SandboxHandler` has no field, no
route, and no way to reach a method it doesn't know exists.

Composition in `main.go` — decorators stack, each stage's output type
matching the next stage's input:

```go
var sandboxService sandbox.Service = sandbox.NewService(gw)               // backend-v2 default impl
sandboxService = sandboxes.NewQuotaEnforcer(sandboxService, limit)        // still sandbox.Service
extendedSandboxService := sandboxes.NewRestarter(sandboxService)          // now ExtendedService
sandboxHandler := sandboxes.NewHandler(base, extendedSandboxService)      // needs ExtendedService
```

Verified: quota is still enforced *through* a restart (it internally
deletes then re-creates, both of which still flow through
`QuotaEnforcer`), and `RestartSandbox` works even though `backend-v2`
has zero knowledge it exists.

## The rule this leaves us with

- **No new capability, no behavior change** → reuse upstream's
  `Service`/`Handler` directly. (Provider.)
- **Behavior change on an existing method, same signature** → decorate
  `sandbox.Service` (embed it, override the methods that change). Upstream's
  handler still works unmodified since `Service`'s *shape* didn't change.
  (Quota — `CreateSandbox`/`DeleteSandbox` still have the same signatures.)
- **A genuinely new method** → declare a local interface that embeds
  upstream's and adds it, decorate up to that new interface, and write a
  (small) handler against the new interface for the routes upstream's
  handler structurally cannot expose. (Restart.)

Only the third case requires both a new interface *and* a rewritten
handler. The first two need neither.

## Building this right now: `go.work`

`backend-v2` hasn't cut a release yet — there's no tag to pin to over the
network. `downstream-bff/go.mod` still has a normal `require` line:

```
require github.com/Gkrumbach07/openshell-dashboard/backend-v2 v0.1.0
```

That version doesn't exist on the module proxy yet, so on its own this
wouldn't resolve. What makes `go build` work today is `../go.work` (repo
root):

```
go 1.26.5

use (
    ./backend-v2
    ./downstream-bff
)
```

Go workspace mode (`go.work`) is the standard mechanism for developing
multiple modules in the same checkout together: any module listed in `use`
is resolved from local source, regardless of what version its dependents
require. It's local-only and doesn't touch either module's `go.mod`/
`go.sum` — CI or any other clone without a `go.work` file resolves
`backend-v2` the normal way (a real, checksummed, tagged version), which is
exactly the versioning story below.

## How upstream (backend-v2) makes itself pinnable

See `../backend-v2/README.md`'s "Publishing a pinnable version" section for
the full mechanism (git tag format for a subdirectory module, the Go Import
Compatibility Rule for breaking changes, `gorelease`, private-module
`GOPRIVATE` setup). Short version: once `backend-v2/v0.1.0` is tagged and
pushed to `origin`, delete (or `GOWORK=off`) this workspace file and the
`require` line above resolves for real — `go mod tidy` fetches it from the
module proxy and records its checksum in `go.sum`, and this module never
sees a change in `backend-v2` again until someone deliberately runs
`go get -u`.
