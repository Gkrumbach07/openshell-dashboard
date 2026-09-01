---
description: Go BFF conventions for the OpenShell Dashboard backend
globs: "backend/**/*.go"
alwaysApply: false
---

# Go BFF Conventions

## Directory structure

```
backend/
├── cmd/server/main.go        # Entry point, flag parsing, server setup
├── internal/
│   ├── api/                   # HTTP handlers and routing
│   │   ├── app.go             # App struct, NewApp(), Routes()
│   │   ├── respond.go         # writeJSON, writeError, writeSDKError, decodeBody, validDNS1123
│   │   ├── *_handler.go       # Per-resource handlers (sandboxes, workspaces, providers, etc.)
│   │   ├── *_handler_test.go  # Table-driven handler tests
│   │   └── mock_sdk_test.go   # SDK test doubles
│   ├── auth/                  # Proxy-delegated auth middleware
│   │   └── proxy.go           # Token extraction from headers
│   └── models/                # Response DTOs and request builders
│       ├── models.go          # DTOs shared with the frontend
│       ├── builders.go        # Request structs and lightweight builders
│       ├── sdk_converters.go  # SDK <-> frontend JSON conversion
│       ├── policyproto.go     # SDK policy <-> vendored proto bridge
│       └── observability.go   # Observability/metrics helpers
│   └── sdkclient/             # Narrow SDK escape hatches
│       ├── auth.go            # Per-request bearer forwarding
│       └── rawexec.go         # Non-TTY stdin exec for binary uploads
├── go.mod
└── go.sum
```

## Router

Use `go-chi/chi` for routing. Handler signature (no `Handler` suffix):

```go
func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request)
```

URL params via `chi.URLParam(r, "workspace")`.

## Gateway client

The vendored Go SDK is the source of truth:

```go
import openshell "github.com/NVIDIA/OpenShell/sdk/go/openshell/v1"
```

Handlers receive `openshell.ClientInterface` as `app.sdk` and call SDK sub-clients
directly (`Sandboxes()`, `Workspaces()`, `Providers()`, `Exec()`, `Inference()`,
`Policy()`, `Services()`, ...).

The one intentional exception is `internal/sdkclient/rawexec.go`: it uses the
SDK's generated proto client for binary-safe uploads because the public exec API
still lacks a non-TTY stdin path. Do not add new local wrappers, copied protos,
or generated stub trees unless there is a concrete upstream SDK gap you can
point to.

## Handlers

Handlers use package-level helpers from `respond.go`:

```go
func (app *App) GetSandbox(w http.ResponseWriter, r *http.Request) {
    sandbox, err := app.sdk.Sandboxes().Get(r.Context(), workspace, name)
    if err != nil {
        writeSDKError(w, err)
        return
    }
    writeJSON(w, http.StatusOK, models.FromSDKSandbox(sandbox))
}
```

Key patterns:
- `decodeBody(w, r, &dst)` — handles MaxBytesReader, DisallowUnknownFields, writes error response on failure, returns false
- `writeJSON(w, statusCode, payload)` — marshals and writes
- `writeError(w, statusCode, code, message)` — writes ErrorResponse envelope
- `writeSDKError(w, err)` — maps SDK and fallback gRPC status errors to HTTP status codes
- `validDNS1123(name)` — validates resource names
- Convert SDK responses through `models.FromSDK*()` helpers or explicit DTO assembly before serializing to JSON
- For policy JSON, preserve the existing protojson contract through `models.ParseSDKPolicy` / `marshalSDKPolicy`; do not hand-roll `map[string]any` policy parsing

## Auth

Relay-only (ADR 0002): the BFF never terminates authentication. A fronting proxy (oauth2-proxy standalone, the host platform's proxy when embedded) owns login/sessions/refresh/CSRF and injects the bearer.

Bearer resolution is one precedence chain in `auth/proxy.go`, identical everywhere:

1. `x-forwarded-access-token` header (injected by the fronting proxy)
2. `Authorization: Bearer` header (API clients)
3. No bearer → 401

The token lands in request context; `sdkclient.ContextAuthProvider` forwards it
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
    Code    string `json:"code"`
    Message string `json:"message"`
}
```

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
use `go doc`. `internal/models/policyproto.go` intentionally uses the SDK's
vendored `proto/sandboxv1` package only to preserve the frontend's protojson
policy contract; do not reintroduce `backend/proto/`, `backend/gen/`, or an
`internal/gateway/` wrapper layer.
