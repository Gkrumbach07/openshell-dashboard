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
│   │   ├── *_handler.go       # Per-resource handlers
│   │   └── middleware.go      # Auth, CORS, logging
│   ├── auth/                  # OIDC middleware
│   ├── sdkclient/             # SDK auth provider (per-request JWT forwarding)
│   │   └── auth.go            # ContextAuthProvider
│   └── models/                # Response DTOs and SDK type converters
├── go.mod
└── go.sum
```

## Router

Use `go-chi/chi` for routing. Handler signature:

```go
func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request)
```

URL params via `chi.URLParam(r, "workspace")`.

## SDK client

The BFF uses `openshell-sdk-go` via a single shared `openshell.ClientInterface`. Handlers access sub-clients directly:

```go
sandboxes, err := app.client.Sandboxes().List(r.Context(), workspace)
```

Per-request JWT forwarding is handled by `ContextAuthProvider` in `internal/sdkclient/auth.go`, which reads the token from the request context on every gRPC call.

## Auth

OIDC via `go-oidc` v3. Per-request flow:
1. Extract JWT from `Authorization: Bearer` header or HTTP-only cookie
2. Validate against gateway's OIDC issuer JWKS
3. Forward same JWT to gateway on every SDK call via `ContextAuthProvider`
4. Gateway enforces RBAC (admin/user roles) and workspace membership

## Configuration

CLI flags with env var fallbacks:

| Flag | Env Var | Description |
|------|---------|-------------|
| `-port` | `PORT` | Listen port (default 8080) |
| `-gateway-url` | `OPENSHELL_GATEWAY_URL` | Gateway gRPC endpoint |
| `-oidc-issuer` | `OIDC_ISSUER` | OIDC issuer URL |
| `-oidc-client-id` | `OIDC_CLIENT_ID` | OIDC client ID |
| `-static-dir` | `STATIC_DIR` | Frontend static assets directory |

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
- `slog` for structured logging

## SDK dependency

The BFF depends on `github.com/rhuss/openshell-sdk-go`. Update with `go get -u` in `backend/`.
