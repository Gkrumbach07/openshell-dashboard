# backend-v2 — interface decorator pattern reference

**THIS IS VIBECODED AND ONLY FOR SHOWCASING A POSSIBLE ARCHITECTURE**

Reference implementation of the file/service pattern from the "OpenShell
Migration Strategies" doc, applied to `backend/`. It's a **skeleton**, not a
full port: `Sandbox` and `Provider` are fully wired end-to-end (service,
decorator, handler, auth); `Policy`, `Inference`, and `Observability` are not
implemented but follow the exact same template.

Standalone Go module — `go build ./...` / `go run ./cmd/api` need nothing
else running (uses an in-memory fake gateway, see below).

## Why this exists

The current `backend/` BFF (`internal/api.App`) has one big struct with every
handler as a method, and one gateway `Interface` implemented by exactly one
`*Client`. That's fine for a single consumer. The migration doc's ask:
downstream wants to reuse most of this BFF but customize specific behaviors
(add audit logging, swap a provider integration, add a caching layer) without
forking the whole handler/service.

The **interface decorator pattern** solves this: every service is a public
`interface` backed by a private default `struct`. Downstream embeds the
plain `Service` interface *by value* in its own struct — no separate
`Decorator` wrapper type needed — and overrides only the methods it cares
about; every other method is promoted straight through to whatever concrete
`Service` was passed in.

## Layout

Fully package-based (doc's second file-pattern option): each bounded context
is one package holding its service, decorator, and HTTP handler together.
Only things genuinely shared across contexts — DTOs and HTTP infra — get
their own package, per the doc's circular-import caveat.

```
backend-v2/
  cmd/api/main.go          entrypoint: auth -> gateway -> services -> handlers -> routes
  pkg/
    sandbox/
      service.go            Service interface (+ compatibility contract) + private default impl + NewService
      handler.go             SandboxHandler(base, Service) + RegisterRoutes
    provider/                 same two files, exact copy of the sandbox template
    gateway/
      interface.go           Interface — the shared client/mock SDK connection every domain service depends on
      fake.go                 in-memory Interface impl; reads auth context (see below)
    models/                  shared DTOs (kept separate: both sandbox and provider need
                              request/response shapes; a single package avoids a cycle)
    httpx/
      handler.go              shared Handler base (logger) + WriteJSON/WriteError/DecodeBody
    auth/proxy.go            auth middleware, ported from backend/internal/auth — public (see below)
  internal/
    config/                  env loading, deliberately not reusable across BFFs
  examples/audit/
    auditing_sandbox_service.go   in-process worked example: decorate sandbox.Service
```

There's also `../downstream-bff/`, a *separate Go module* that actually
consumes this one as a dependency — see its README for how it decides,
per domain, when a full anti-corruption layer is worth the extra code
versus consuming these types directly.

`pkg/gateway` and `pkg/models` are not domain packages — they're
cross-cutting (every domain service talks through the same gateway
client/mock SDK connection, and every domain needs DTOs), so factoring
them out avoids duplicating the same interface in every domain package.
`pkg/sandbox` and `pkg/provider` both import `pkg/gateway.Interface` and
`pkg/models`; they don't import each other.

## The pattern, concretely

```go
// pkg/sandbox/service.go
type Service interface { CreateSandbox(...) ...; GetSandbox(...) ...; ... } // append-only, see below

type service struct{ gw gateway.Interface } // private — can't be referenced outside the package
func NewService(gw gateway.Interface) Service { return &service{gw: gw} }
```

`gateway.Interface` is the one shared contract every domain service talks
to the underlying client/mock SDK connection through (`pkg/gateway.Fake`
for this demo; a real deployment's gRPC-backed client in production) —
`sandbox.service` and `provider.service` both hold a `gateway.Interface`
value, not a concrete `*Fake` or `*Client`, so the transport can be swapped
without touching either domain package.

Downstream, in its own package — no upstream `Decorator` type to import,
just embed `Service`:

```go
type AuditingSandboxService struct {
    sandbox.Service // embedded by value, not a wrapper struct
    logger *slog.Logger
}

func (a *AuditingSandboxService) CreateSandbox(ctx context.Context, ws string, req models.CreateSandboxRequest) (*models.Sandbox, error) {
    sb, err := a.Service.CreateSandbox(ctx, ws, req) // delegate to the embedded field
    audit.Log(ctx, "sandbox.create", ws, req.Name, err)
    return sb, err
}
// GetSandbox / ListSandboxes / DeleteSandbox: inherited unmodified — and so
// is anything Service gains later (see "Interface evolution" below).
```

`main.go` decides whether to wrap:

```go
var svc sandbox.Service = sandbox.NewService(gw)
if cfg.AuditDecorators {
    svc = audit.NewAuditingSandboxService(svc, logger)
}
sandbox.NewSandboxHandler(base, svc) // handler never knows a decorator exists
```

Run with `AUDIT_DECORATORS=false go run ./cmd/api` to see create/delete
without the audit log lines — proof the handler and route layer are fully
decoupled from which concrete `Service` is behind the interface.

## Interface evolution: staying compilable as upstream changes Service

This was the open design question: if upstream adds/changes methods on
`Service`, does every downstream decorator need to be touched?

**Additive changes (new method) — no, automatically.** Because
`AuditingSandboxService` embeds `sandbox.Service` *by value* (a field of
interface type), Go promotes every method of that interface to
`AuditingSandboxService`'s method set, including ones added after
`AuditingSandboxService` was written. The promoted method isn't a
copy-pasted forwarding stub someone has to maintain — it's live method
resolution against whatever concrete value is stored in the `Service`
field. Proved in this repo: a `RestartSandbox` method was added to
`sandbox.Service` and its default impl, then `go build ./...` was run
without touching `examples/audit/` at all — it still compiled and
`AuditingSandboxService` still satisfies `sandbox.Service`, because it never
had to declare `RestartSandbox` itself.

This is the actual reason to embed the plain interface instead of writing a
generated per-method forwarding wrapper (a "real" GoF decorator in other
languages): a hand-written forwarder breaks the moment upstream adds a
method, because it doesn't implement the new one. Interface embedding
doesn't have that failure mode.

**Non-additive changes (remove a method, change a signature) — no
mechanism saves you.** No pattern in Go makes a genuinely breaking change
non-breaking. The mitigation is upstream discipline, not downstream code:

- Treat every `Service` interface as **append-only** (documented directly
  on `Service` in `service.go`). Never remove a method or change a
  signature in place.
- If a capability must change shape, add a new interface (`ServiceV2`) or a
  new method (`CreateSandboxV2`) instead of editing the existing one.
  Existing downstream code keeps compiling against `Service`; new code
  opts into `ServiceV2`.
- Enforce the contract in CI rather than by convention — `golang.org/x/exp/cmd/gorelease`
  or `golang.org/x/tools/go/analysis/passes/...` style API-diff tooling can
  fail a PR that removes or resignatures an exported interface method.
- Keep interfaces narrow per bounded context (already true here — `Service`
  per domain, not one giant interface) so a breaking change in `Policy`
  can't force a rebuild of code that only touches `Sandbox`.

That said, "upstream discipline" is a hope, not a guarantee, once upstream
is a separate team/repo you don't control. `../downstream-bff/` shows the
downstream-side mitigation that doesn't depend on upstream behaving: each
domain gets its own package, so a breaking change here is contained to that
package (plus the one line in the consumer's composition root that always
has to construct the concrete service, ACL or not). A full
anti-corruption layer — separate local interface, separate DTOs, one
adapter file — is a further escalation worth reaching for only when you
need to keep your own external contract stable independent of upstream, or
intend to swap the implementation outright; see `downstream-bff/README.md`
for why that wasn't the default choice there.

## Auth

Ported as-is from `backend/internal/auth/proxy.go` (ADR 0002 relay-only
model), but lives in `pkg/auth`, not `internal/auth`: the relay-only model
is a platform-wide decision every downstream BFF fronting the same proxy
needs identically, and `internal/` is enforced by the Go toolchain at the
*module* boundary — a real separate module (`downstream-bff`) literally
cannot import an `internal/` package from another module, which would force
reimplementing security-relevant code instead of reusing it. `downstream-bff`
imports `backend-v2/pkg/auth` directly and gets the exact same middleware.

The BFF never terminates auth or validates tokens — a fronting proxy
(oauth2-proxy, etc.) does that and injects the user's bearer token as a
header. `auth.Middleware` reads it (proxy header, falling back to
`Authorization: Bearer`) and stores it on the **request context**.

That's the industry-standard mechanism here, not a struct field or a global:
`context.Value` with an unexported key type, scoped to the single request,
propagated automatically through every function that takes `ctx` — handler
-> service -> gateway. `pkg/gateway.Fake` demonstrates the far end of that
chain by reading it back via `auth.TokenFromContext` / `UserFromContext`,
exactly like the real `backend/internal/gateway/client.go`'s
`grpc.PerRPCCredentials.GetRequestMetadata` does before dialing the gateway.

```go
// pkg/auth/proxy.go
func TokenFromContext(ctx context.Context) string { ... }

// pkg/gateway/fake.go — stand-in for the real client's PerRPCCredentials
func (f *Fake) logCall(ctx context.Context, rpc string) {
    f.logger.Debug("gateway call", "rpc", rpc, "user", auth.UserFromContext(ctx), "hasToken", auth.TokenFromContext(ctx) != "")
}
```

Env vars (same names as `backend/cmd/server/main.go`): `AUTH_DISABLED`,
`AUTH_TOKEN_HEADER`, `AUTH_USER_HEADER`. Verified behavior:

```
curl localhost:8080/api/v1/workspaces/ws1/sandboxes                                    -> 401
curl -H "Authorization: Bearer t" localhost:8080/api/v1/workspaces/ws1/sandboxes       -> 200
AUTH_DISABLED=true go run ./cmd/api                                                     -> no token required (dev-user)
```

## Publishing a pinnable version

For `downstream-bff` (or any real consumer) to pin an exact backend-v2
release in its `go.mod` — instead of always building against whatever's on
`main` — backend-v2 needs an actual tagged, pushed release. There's no
separate "publish" step beyond that; Go's module system is decentralized
and resolves straight from the VCS host (or a proxy that mirrors it).

1. **It's already a real module.** `backend-v2/go.mod`'s module path,
   `github.com/Gkrumbach07/openshell-dashboard/backend-v2`, matches this
   repo's actual `origin` (`github.com/Gkrumbach07/openshell-dashboard`).
   Nothing to change here — this is the module identity `go get` will
   resolve.

2. **Tag with the subdirectory prefix.** Because this module lives in a
   subdirectory of the repo (not at repo root), Go's versioning spec
   requires the tag to be prefixed with the module's path relative to the
   repo root:

   ```
   git tag backend-v2/v0.1.0
   git push origin backend-v2/v0.1.0
   ```

   A bare `v0.1.0` tag would be ambiguous (there's also a `backend/`
   module at a different subdirectory) and Go would ignore it for this
   module. Consumers still write a plain `v0.1.0` in their `go.mod`
   `require` line — the prefix only exists at the git-tag level; Go strips
   it automatically once it's found the module's `go.mod` in that
   subdirectory.

3. **Before tagging, diff the public API.** `go run golang.org/x/exp/cmd/gorelease@latest`
   compares the current code against the last tagged version and reports
   whether the change is a valid patch/minor, or requires a major bump —
   it will flag it if, say, a method got removed from `sandbox.Service`
   without a version bump to match. This turns the append-only contract
   documented on `Service` from a comment into something a CI job can
   actually enforce, even without upstream's cooperation on discipline —
   it's a check *you* (or downstream) can run against any commit before
   depending on it.

4. **A real breaking change needs a new import path, not just a new
   tag.** Go's Import Compatibility Rule: once you owe backwards
   compatibility (v1.0.0+), a breaking change requires the module path
   itself to gain a version suffix — `module .../backend-v2/v2` in
   `go.mod`, tag `backend-v2/v2.0.0`. Existing consumers importing
   `.../backend-v2` (no suffix) are physically unaffected — they can't
   accidentally pick up the breaking version even by running `go get -u`,
   because it's a different import path. New consumers opt in explicitly
   by importing `.../backend-v2/v2`. This is what makes "downstream keeps
   compiling" a guarantee instead of a hope, for changes too big to be
   additive.

5. **Consumer side**, once a tag exists:

   ```
   go get github.com/Gkrumbach07/openshell-dashboard/backend-v2@v0.1.0
   ```

   writes the exact version and its content hash into the consumer's
   `go.mod`/`go.sum`. Nothing about backend-v2 changes for that consumer
   again until someone runs `go get -u` there, on purpose.

6. **If the repo is private**, `go get` needs `GOPRIVATE=github.com/Gkrumbach07/*`
   (skips the public checksum database / proxy for that path and goes
   straight to VCS) plus normal git auth (SSH key or a credential helper)
   for the clone.

`downstream-bff` isn't there yet — no tag has been cut, so its `go.mod`
`require` line points at a version that doesn't resolve over the network.
`../go.work` is what makes it build right now anyway, by resolving
backend-v2 from local source. See `downstream-bff/README.md`.

## Extending to Policy / Inference / Observability

Each is a new sibling package `pkg/<domain>/` with the same two
files (`service.go`, `handler.go`). Extend `pkg/gateway.Interface` with
that domain's RPCs (see `backend/internal/gateway/interface.go` for the
full real surface — policies, inference routes, drafts, settings, logs,
services) and add the matching methods + Record type(s) to `pkg/gateway`
(`interface.go`, `fake.go`). Wire the new service/handler pair into
`cmd/api/main.go` the same way Sandbox and Provider are wired now. If a
domain's DTOs are only used by that domain (not shared), put them in a
`model.go` inside the domain package instead of `pkg/models` — the doc's
package-based option calls this out as the default; `pkg/models` here is
the explicit circular-import exception.

## What's intentionally not real here

- `pkg/gateway.Fake` is in-memory, not gRPC. Swapping in a real
  `*gateway.Client` (gen/openshellv1 stubs, bearer-token relay per ADR 0002,
  same shape as `backend/internal/gateway/client.go`) requires no change to
  any service, handler, or downstream decorator — that substitutability is
  the point of depending on `gateway.Interface`.
- Static asset serving and the rest of `backend/`'s handlers (workspaces,
  policies, drafts, logs, terminal, services, inference) are out of scope
  for this skeleton.
