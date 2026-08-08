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
│   │   ├── respond.go         # writeJSON, writeError, writeGrpcError, decodeBody, validDNS1123
│   │   ├── *_handler.go       # Per-resource handlers (sandboxes, workspaces, providers, etc.)
│   │   └── *_handler_test.go  # Table-driven handler tests
│   ├── auth/                  # Proxy-delegated auth middleware
│   │   └── proxy.go           # Token extraction from headers
│   ├── gateway/               # Thin gRPC wrapper
│   │   ├── client.go          # Connection setup, per-RPC bearer forwarding
│   │   ├── interface.go       # Interface type (for test mocking)
│   │   ├── sandboxes.go       # Sandbox CRUD
│   │   ├── workspaces.go      # Workspace + member CRUD
│   │   ├── providers.go       # Provider + profile CRUD
│   │   ├── policies.go        # Policy + draft policy
│   │   ├── inference.go       # Inference route CRUD
│   │   ├── logs.go            # GetSandboxLogs + provider attach/detach
│   │   └── services.go        # ExposeService, ListServices, DeleteService
│   └── models/                # Response DTOs and request builders
│       ├── models.go          # FromSandbox(), FromWorkspace(), FromProvider(), etc.
│       ├── builders.go        # BuildSandboxSpec(), ParsePolicy(), complex request structs
│       └── observability.go   # Observability/metrics helpers
├── proto/                     # Copied from NVIDIA/OpenShell/proto/
├── gen/                       # protoc-generated Go stubs (committed)
│   ├── datamodelv1/           # Workspace, Provider, ObjectMeta types
│   ├── openshellv1/           # RPCs, Sandbox, SandboxSpec types
│   ├── optionsv1/             # AuthorizationRule, secret field options
│   ├── sandboxv1/             # Policy, SandboxConfig types
│   └── inferencev1/           # Inference route types
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

The `internal/gateway/` package wraps protoc-generated gRPC stubs. Each method is 5-10 lines. The generated types live in separate packages — use the correct one:

```go
func (c *Client) ListSandboxes(ctx context.Context, workspace string, limit, offset uint32, labelSelector string) ([]*openshellv1.Sandbox, error) {
    resp, err := c.openshell.ListSandboxes(ctx, &openshellv1.ListSandboxesRequest{
        Workspace:     workspace,
        Limit:         limit,
        Offset:        offset,
        LabelSelector: labelSelector,
    })
    if err != nil {
        return nil, err
    }
    return resp.Sandboxes, nil
}
```

When adding a new wrapper, also add the method to `interface.go` (the `Interface` type used by test mocks).

## Handlers

Handlers use package-level helpers from `respond.go`:

```go
func (app *App) CreateSandbox(w http.ResponseWriter, r *http.Request) {
    var body models.CreateSandboxRequest
    if !decodeBody(w, r, &body) {
        return
    }
    spec, err := models.BuildSandboxSpec(body)
    if err != nil {
        writeError(w, http.StatusBadRequest, "invalid_spec", err.Error())
        return
    }
    sandbox, err := app.gateway.CreateSandbox(r.Context(), workspace, body.Name, spec, body.Labels, body.Annotations)
    if err != nil {
        writeGrpcError(w, err)
        return
    }
    writeJSON(w, http.StatusCreated, models.FromSandbox(sandbox))
}
```

Key patterns:
- `decodeBody(w, r, &dst)` — handles MaxBytesReader, DisallowUnknownFields, writes error response on failure, returns false
- `writeJSON(w, statusCode, payload)` — marshals and writes
- `writeError(w, statusCode, code, message)` — writes ErrorResponse envelope
- `writeGrpcError(w, err)` — maps gRPC status codes to HTTP status codes
- `validDNS1123(name)` — validates resource names
- Always convert proto responses through `models.From*()` before serializing to JSON

## Auth

Relay-only (ADR 0003): the BFF never terminates authentication. A fronting proxy (oauth2-proxy standalone, kube-auth-proxy federated) owns login/sessions/refresh/CSRF and injects the bearer. Scope bounded by ADR 0004.

Bearer resolution is one precedence chain in `auth/proxy.go`, identical everywhere:

1. `x-forwarded-access-token` header (injected by the fronting proxy)
2. `Authorization: Bearer` header (API clients)
3. No bearer → 401

The token lands in request context; `gateway/client.go` forwards it as gRPC `authorization: Bearer` metadata via per-RPC credentials. Gateway enforces RBAC (admin/user roles) and workspace membership — the BFF never does.

The BFF does NOT validate tokens, call JWKS endpoints, parse JWTs, or make authorization decisions. Zero dependency on `go-oidc`. There are no OIDC endpoints, no session codec, no CSRF middleware — if you find yourself adding any of these, stop and read ADR 0003.

Auth-adjacent routes (under `/api/v1/`): `auth/config` (bootstrap: authDisabled + feature flags), `auth/whoami` (gateway `GetCurrentUser`). That's all.

Before adding anything auth-adjacent, check the ADR 0004 never-list: no auth termination, no JWT validation, no RBAC, no k8s API calls, no credential brokering, no server-side state.

## Configuration

Env vars (some also available as CLI flags):

| Env Var | Flag | Default | Description |
|---------|------|---------|-------------|
| `PORT` | `-port` | `8080` | BFF listen port |
| `OPENSHELL_GATEWAY_URL` | `-gateway-url` | `localhost:50051` | Gateway gRPC endpoint |
| `GATEWAY_CA_CERT` | `-gateway-ca-cert` | | CA cert for gateway TLS |
| `STATIC_DIR` | `-static-dir` | | Frontend static assets directory |
| `AUTH_DISABLED` | `-auth-disabled` | `false` | Skip auth — dev only |
| `AUTH_TOKEN_HEADER` | `-auth-token-header` | `x-forwarded-access-token` | Token header name |
| `AUTH_USER_HEADER` | `-auth-user-header` | `x-auth-request-user` | User header name |
| `ALLOWED_ORIGINS` | `-allowed-origins` | | Comma-separated CORS origins |
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
- `mock_gateway_test.go` implements `gateway.Interface` for test stubs
- `slog` for structured logging

## Proto regeneration

```bash
make proto  # runs protoc on backend/proto/*.proto → backend/gen/
```

Proto files are copied from `NVIDIA/OpenShell/proto/`. Keep them in sync manually or via CI check.
