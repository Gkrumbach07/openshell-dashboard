---
description: Go BFF conventions for the OpenShell Dashboard backend
globs: "backend/**/*.go"
alwaysApply: false
---

# Go BFF Conventions

## Directory structure

Everything the BFF exposes lives under `pkg/` so downstream consumers can
import it. There is no `backend/internal/` tree.

```
backend/
├── cmd/server/main.go        # Entry point, flag parsing, server setup
├── pkg/
│   ├── server/                # App wiring and routing
│   │   └── app.go             # App struct, NewApp(), Routes()
│   ├── handlers/              # HTTP handlers, one struct per resource
│   │   ├── *_handler.go       # SandboxHandler, WorkspacesHandler, ...
│   │   ├── *_handler_test.go  # Table-driven handler tests
│   │   └── mock_sdk_test.go   # SDK test doubles
│   ├── services/              # Thin interfaces over the SDK — the extension seam
│   │   ├── sandbox.go         # SandboxServiceInterface, NewSandboxService
│   │   └── ...                # One file per resource
│   ├── apiutils/              # Shared HTTP helpers
│   │   └── respond.go         # WriteJSON, WriteError, WriteSDKError, DecodeBody,
│   │                          # ValidDNS1123, ResponseCode constants
│   ├── auth/                  # Proxy-delegated auth middleware
│   │   └── proxy.go           # Token extraction from headers
│   ├── clients/               # Narrow SDK escape hatches
│   │   ├── auth.go            # Per-request bearer forwarding
│   │   ├── rawexec.go         # Non-TTY stdin exec for binary uploads
│   │   ├── rawprovider.go     # Keys of the credentials a provider holds
│   │   └── rawprofile.go      # Provider profiles, whole (endpoints included)
│   └── models/                # Response DTOs and request builders
│       ├── models.go          # DTOs shared with the frontend
│       ├── auth.go            # AuthConfigResponse, FeatureFlags
│       ├── builders.go        # Request structs and lightweight builders
│       ├── sdk_converters.go  # SDK <-> frontend JSON conversion
│       ├── policyproto.go     # SDK policy <-> vendored proto bridge
│       └── observability.go   # Observability/metrics helpers
├── go.mod
└── go.sum
```

## Router

Routes are declared in `pkg/server/app.go` with `go-chi/chi` and dispatch to a
handler struct. Method names carry no `Handler` suffix — the struct does:

```go
func (h *SandboxHandler) ListSandboxes(w http.ResponseWriter, r *http.Request)
```

URL params via `r.PathValue("workspace")`. chi populates these through
`SetPathValue` on every matched route (`mux.go`, `routeHTTP`), so handlers do
not import chi. chi added that call in **v5.2.4** — on anything older every
`r.PathValue` silently returns `""`, so treat v5.2.4 as a hard floor and never
downgrade `github.com/go-chi/chi/v5` below it.

## Gateway client

The vendored Go SDK is the source of truth:

```go
import openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
```

Handlers never hold `openshell.ClientInterface` directly. `NewApp` resolves the
SDK sub-clients once (`Sandboxes()`, `Workspaces()`, `Providers()`, `Exec()`,
`Policy()`, `Services()`, ...), wraps each in a `pkg/services` type, and injects
that interface into the handler as `h.svc`. Downstream can substitute its own
implementation of any `services.*Interface` without forking the handler.

The three intentional exceptions are in `pkg/clients`, and all use the SDK's
generated proto client because of a gap in the public SDK:

- `rawexec.go` streams a file into a sandbox for binary-safe uploads, because
  the public exec API lacks a non-TTY stdin path.
- `rawprovider.go` reads the keys of the credentials a provider holds, because
  the SDK's converter drops the redacted `credentials` map the gateway returns
  them in. `app.SetProviderCredentialKeys` wires it in; handlers reach it
  through `services.ProviderCredentialKeyReader`, beside the SDK call that
  returns the provider itself. `rawprovider_allworkspaces.go` is the same
  read for the all-workspaces provider list.
- `rawprofile.go` reads and writes provider profiles, because the SDK's
  profile endpoint type keeps a host, a port and a protocol and drops the
  access preset, enforcement and L7 rules the gateway stores with them. An
  update replaces the stored profile, so a profile that went through the SDK
  type would come back narrower than it was.

Do not add new local wrappers, copied protos, or generated stub trees unless
there is a concrete upstream SDK gap you can point to, and delete an exception
when its gap closes.

## Mirror the gateway

The BFF translates nothing (see "Stay in parity with the gateway" in
`CLAUDE.md`). A request body carries what the gateway's message carries and is
forwarded as it is; a response carries what the gateway returned, minus
secrets. When a request fails because the gateway wants it another way, change
what the UI sends, not what the BFF forwards. In particular the BFF does not
rename provider credential keys, work out a provider's profile scope, or guess
the type of a setting, and it sends an update only what the request names
rather than a resource it read first.

## Handlers

Handlers use the exported helpers from `pkg/apiutils`:

```go
func (h *SandboxHandler) GetSandbox(w http.ResponseWriter, r *http.Request) {
    sandbox, err := h.svc.Get(r.Context(), r.PathValue("workspace"), r.PathValue("name"))
    if err != nil {
        apiutils.WriteSDKError(w, err)
        return
    }
    apiutils.WriteJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}
```

Key patterns:
- `apiutils.DecodeBody(w, r, &dst)` — handles MaxBytesReader, DisallowUnknownFields, writes error response on failure, returns false
- `apiutils.WriteJSON(w, statusCode, payload)` — marshals and writes
- `apiutils.WriteError(w, statusCode, code, message)` — writes ErrorResponse envelope; `code` is an `apiutils.ResponseCode` constant, never a bare string. Add a new constant rather than inlining a literal.
- `apiutils.WriteSDKError(w, err)` — maps SDK and fallback gRPC status errors to HTTP status codes
- `apiutils.ValidDNS1123(name)` — validates resource names
- Convert SDK responses through `models.FromSDK*()` helpers or explicit DTO assembly before serializing to JSON
- For policy JSON, preserve the existing protojson contract through `models.ParseSDKPolicy` / `marshalSDKPolicy`; do not hand-roll `map[string]any` policy parsing

## Auth

Relay-only (ADR 0002): the BFF never terminates authentication. A fronting proxy (oauth2-proxy standalone, the host platform's proxy when embedded) owns login/sessions/refresh/CSRF and injects the bearer.

Bearer resolution is one precedence chain in `pkg/auth/proxy.go`, identical everywhere:

1. `x-forwarded-access-token` header (injected by the fronting proxy)
2. `Authorization: Bearer` header (API clients)
3. No bearer → 401

The token lands in request context; `clients.ContextAuthProvider` forwards it
on every SDK/gRPC call as `authorization: Bearer` metadata. Gateway enforces
RBAC (admin/user roles) and workspace membership — the BFF never does.

The BFF does NOT validate tokens, call JWKS endpoints, parse JWTs, or make authorization decisions. Zero dependency on `go-oidc`. There are no OIDC endpoints, no session codec, no CSRF middleware — if you find yourself adding any of these, stop and read ADR 0002.

Auth-adjacent routes (under `/api/v1/`): `auth/config` (bootstrap: authDisabled + feature flags), `auth/whoami` (gateway `GetCurrentUser`). That's all.

Before adding anything auth-adjacent, check ADR 0002: no auth termination, no JWT validation, no RBAC, no k8s API calls, no credential brokering, no server-side state.

## Configuration

Env vars (some also available as CLI flags):

| Env Var | Flag | Default | Description |
|---------|------|---------|-------------|
| `PORT` | `-port` | `8080` | BFF listen port |
| `LISTEN_ADDRESS` | `-listen-address` | | Optional listen address override |
| `OPENSHELL_GATEWAY_URL` | `-gateway-url` | `localhost:50051` | Gateway gRPC endpoint |
| `GATEWAY_CA_CERT` | `-gateway-ca-cert` | | CA cert for gateway TLS |
| `GATEWAY_CLIENT_CERT` | `-gateway-client-cert` | | Client cert for gateway mTLS |
| `GATEWAY_CLIENT_KEY` | `-gateway-client-key` | | Client key for gateway mTLS |
| `TLS_CERT_FILE` | `-tls-cert` | | Server cert for inbound BFF HTTPS |
| `TLS_KEY_FILE` | `-tls-key` | | Server key for inbound BFF HTTPS |
| `STATIC_DIR` | `-static-dir` | | Frontend static assets directory |
| `AUTH_DISABLED` | `-auth-disabled` | `false` | Skip auth — dev only |
| `AUTH_TOKEN_HEADER` | `-auth-token-header` | `x-forwarded-access-token` | Token header name |
| `AUTH_USER_HEADER` | `-auth-user-header` | `x-auth-request-user` | User header name |
| `ADMIN_ROLE` | `-admin-role` | `admin` | OIDC role claim for admin (display gating only — gateway enforces) |
| `LOGOUT_URL` | `-logout-url` | `/oauth2/sign_out` | Proxy sign-out path the frontend redirects to on logout |
| `GATEWAY_RELEASE_LINE` | `-gateway-release-line` | compiled in | Gateway release line this build is for, written `major.minor` (`0.1`). A gateway whose version starts with those two numbers is `supported` (any patch, pre-release, dev build or downstream rebuild), any other line is `unsupported`, and a gateway with no usable version is `unknown`. The default is `models.BuiltInGatewayReleaseLine` in `backend/pkg/models/gateway_release_line.go`, the line of the release `deploy/ci/gateway-pins.json` names; `node scripts/gateway-range.mjs --check` fails in CI when the two disagree. Override it only for tests and local development: no image or chart sets it, and a value that is not a line turns the status into `unknown`. The verdict is served by `GET /gateway/compatibility` to every signed-in user (version read from the gateway's unauthenticated health check) and also rides on `GET /gateway`, which the gateway answers for platform admins only. Informational only — the BFF never blocks on it (ADR 0009) |
| `FEATURE_*` | | varies | Feature flags: `FEATURE_TERMINAL`, `FEATURE_FILE_TRANSFER`, `FEATURE_SETTINGS`, `FEATURE_GLOBAL_POLICY`, `FEATURE_CREDENTIAL_REFRESH`, `FEATURE_SERVICES`, `FEATURE_DRAFT_POLICY` |

## Error handling

Standard error envelope:

```go
type ErrorResponse struct {
    Code    ResponseCode `json:"code"`
    Message string       `json:"message"`
}
```

`ResponseCode` is a string enum in `pkg/apiutils/respond.go`. Every code the BFF
can return is declared there so the frontend has one authoritative list.

## Testing

- Table-driven tests with `*_test.go` adjacent to implementation
- `httptest.NewRecorder()` + `http.NewRequest()` for handler tests
- `mock_sdk_test.go` provides `openshell.ClientInterface` test doubles for handler coverage
- `rawexec_test.go`, `rawprovider_test.go` (with `rawprovider_allworkspaces_test.go`) and `rawprofile_test.go` cover the three low-level gRPC escape hatches against a fake gateway that enforces the real one's 1 MiB message limit
- `slog` for structured logging

## SDK updates

The SDK is pinned to the commit of an upstream **release tag**, and it moves
together with the gateway the branch pins: one upstream release, one commit
(ADR 0009, decision 7; hard facts 17 and 20 in `openshell-api.md`). Never
`go get ...@latest` or a branch: `@latest` is whatever upstream HEAD is that
minute, and nothing was tested against it.

You do not do this by hand, and not in a pull request of your own. The Follow
upstream workflow (`.github/workflows/follow-upstream.yml`) reads upstream's
tags every hour and makes the move on the `next` branch, as the first commit
after `main`: the pins file, `go.mod`, `go.sum`, the built-in release line when
the minor changes, and the README's generated block. `next` pins the newest
pre-release until upstream cuts the stable release, then that; merging `next`
is how `main` moves. See `deploy/ci/upstream/README.md`.

What is left for a person is the work the move makes necessary:

- **The BFF no longer builds, vets or passes its tests against the new SDK**
  (CI on the `next` pull request is red in `check-backend`). That is a source
  migration: fix the call sites and the test doubles in `mock_sdk_test.go` in
  a pull request **into `next`**, not `main`. It cannot land on `main`, where
  the SDK is still the old one.
- **The compat suite fails on `next`** (`compat` is red there). The console on
  the new SDK does not work with the new gateway: fix it on `next` too.
- **Check A's issue is open** (label `compat-migrate`). The console as `main`
  builds it fails against the upcoming gateway. On `main`'s own release line
  that is upstream breaking a Stable interface; the issue says what to do.

To look at a move before the workflow has made it, or to reproduce one:

```bash
python3 deploy/ci/upstream/follow.py plan --out /tmp/plan.json   # the target, its tag's commit and its image digests

cd backend
go get github.com/NVIDIA/OpenShell/sdk/go@<the tag's commit>
go mod tidy
go build ./... && go vet ./... && go test ./...   # the source link: SDK <-> BFF
```

Do not commit that to a branch of your own. If the pins do have to be changed
by hand (a release branch, or the workflow is broken), all of it moves in one
commit and CI holds the pieces together:
`python3 deploy/ci/upstream/follow.py validate-pins --go-mod backend/go.mod`,
`node scripts/gateway-range.mjs --check` and
`node scripts/readme-gateway-range.mjs --write`. Only `next` may pin a
pre-release; the `pins a stable release` check refuses one anywhere else.

There is no local proto regeneration flow anymore. If you need to inspect an
RPC or type shape, read the vendored SDK package (`openshell/v1`, `types/*`) or
use `go doc`. `pkg/models/policyproto.go` intentionally uses the SDK's
vendored `proto/sandboxv1` package only to preserve the frontend's protojson
policy contract; do not reintroduce `backend/proto/`, `backend/gen/`, or an
`backend/internal/` wrapper layer.
