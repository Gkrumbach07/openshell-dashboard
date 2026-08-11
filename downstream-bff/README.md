# downstream-bff — a real, separate consumer of backend-v2

This is what "downstream reuses the BFF" looks like when downstream is a
genuinely different Go module (different repo/team in a real setup), not
just a package inside `backend-v2`. It's a second, independently
deployable BFF that depends on `backend-v2` as a library.

Standalone Go module — see "Building this right now" below for why it
builds without `backend-v2` being published anywhere yet.

## What it does differently from backend-v2

- **Sandbox**: adds a per-workspace sandbox quota (`SANDBOX_QUOTA_PER_WORKSPACE`,
  default 2) — a feature backend-v2 has no concept of — via
  `pkg/sandboxes.QuotaEnforcer`.
- **Provider**: no customization; consumes `backend-v2/pkg/provider.Service`
  directly.
- **Auth**: none — reuses `backend-v2/pkg/auth` wholesale. Same relay model,
  same middleware, zero reimplementation.
- **Gateway**: reuses `backend-v2/pkg/gateway.Fake` wholesale for the demo;
  a real deployment would construct a real gRPC client the same way
  backend-v2's own `cmd/api/main.go` would.

## Consuming an upstream domain: one pattern, used for both

`pkg/sandboxes/` (customized, has a decorator) and `pkg/providers/`
(uncustomized, thin pass-through) both consume backend-v2's types
*directly* — `sandbox.Service` / `provider.Service`, `models.Sandbox` /
`models.CreateSandboxRequest`, no local interface, no translated DTOs, no
adapter file.

```
pkg/sandboxes/
  quota.go     QuotaEnforcer — embeds sandbox.Service (upstream's interface) directly
  handler.go   HTTP layer — depends on sandbox.Service directly
pkg/providers/
  handler.go   HTTP layer — depends on provider.Service directly, no decorator
```

An earlier version of this module gave `sandboxes` (then called
`provisioning`) a full anti-corruption layer: its own `Provisioner`
interface, its own `Sandbox`/`CreateRequest` types, and an `adapter.go`
translating between the two. That was cut. Reasoning:

- **The package boundary already does the containment.** A breaking change
  to `sandbox.Service` or `models.Sandbox` can only affect files inside
  `pkg/sandboxes/` (two of them) plus the one line in `cmd/api/main.go`
  that constructs the concrete service — and that composition-root
  reference exists *regardless* of whether an adapter sits behind it. The
  adapter added a translation layer without actually shrinking the set of
  files that would need to change.
- **The decorator didn't need a second interface.** `QuotaEnforcer` embeds
  `sandbox.Service` — upstream's interface — directly, the same
  embed-the-interface-by-value technique `backend-v2/examples/audit` uses
  in-process. Additive changes to `sandbox.Service` still forward for free;
  inventing a parallel local interface bought nothing beyond what
  embedding the real one already gives.
- **YAGNI on the two things a real ACL is actually for.** A full
  ACL (separate local DTOs) earns its keep when you need to (a) keep your
  own external API contract byte-stable while upstream's internal
  representation changes underneath you, or (b) swap the underlying
  implementation entirely someday (different vendor, a fork). Neither is a
  real requirement here today. If either becomes one, promoting
  `pkg/sandboxes` back to own its own types is a contained, mechanical
  change — it's not something you have to guess up front.

**Rule of thumb, revised**: default to consuming upstream types directly,
one package per domain. Reach for a full ACL (own interface + own DTOs +
adapter) only when you have a concrete reason — a stable public contract to
protect, or a real intent to swap implementations — not preemptively for
every dependency.

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
