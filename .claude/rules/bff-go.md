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
│   │   └── rawexec.go         # Non-TTY stdin exec for binary uploads
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

The one intentional exception is `pkg/clients/rawexec.go`: it uses the
SDK's generated proto client for binary-safe uploads because the public exec API
still lacks a non-TTY stdin path. Do not add new local wrappers, copied protos,
or generated stub trees unless there is a concrete upstream SDK gap you can
point to.

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
- `rawexec_test.go` covers the one low-level gRPC escape hatch separately
- `slog` for structured logging

## SDK updates

```bash
go get github.com/NVIDIA/OpenShell/sdk/go@latest
```

There is no local proto regeneration flow anymore. If you need to inspect an
RPC or type shape, read the vendored SDK package (`openshell/v1`, `types/*`) or
use `go doc`. `pkg/models/policyproto.go` intentionally uses the SDK's
vendored `proto/sandboxv1` package only to preserve the frontend's protojson
policy contract; do not reintroduce `backend/proto/`, `backend/gen/`, or an
`backend/internal/` wrapper layer.
