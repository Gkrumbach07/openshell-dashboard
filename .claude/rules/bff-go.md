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
│   ├── gateway/               # Thin gRPC wrapper
│   │   ├── client.go          # Connection, per-RPC OIDC auth
│   │   ├── sandboxes.go       # Sandbox CRUD + logs
│   │   ├── workspaces.go      # Workspace + member CRUD
│   │   ├── providers.go       # Provider + profile CRUD
│   │   ├── policies.go        # Policy + draft policy
│   │   └── inference.go       # Inference route CRUD
│   └── models/                # Response DTOs
├── proto/                     # Copied from NVIDIA/OpenShell/proto/
├── gen/                       # protoc-generated Go stubs (committed)
├── go.mod
└── go.sum
```

## Router

Use `go-chi/chi` for routing. Handler signature:

```go
func (app *App) ListSandboxes(w http.ResponseWriter, r *http.Request)
```

URL params via `chi.URLParam(r, "workspace")`.

## Gateway client

The `internal/gateway/` package wraps protoc-generated gRPC stubs. Each method is 5-10 lines:

```go
func (c *Client) ListSandboxes(ctx context.Context, workspace string) ([]*pb.Sandbox, error) {
    resp, err := c.openshell.ListSandboxes(ctx, &pb.ListSandboxesRequest{
        Workspace: workspace,
    })
    if err != nil {
        return nil, err
    }
    return resp.Sandboxes, nil
}
```

Only wrap user-facing RPCs (~30). Skip supervisor/internal RPCs.

## Auth

Proxy-delegated authentication. An external auth proxy (oauth2-proxy, kube-rbac-proxy, etc.) sits in front of the BFF and handles OIDC. Per-request flow:
1. Auth proxy validates the user's token and injects it as an HTTP header
2. BFF middleware reads the token from the configured header (default `x-forwarded-access-token`)
3. Forward same token to gateway on every gRPC call via `grpc.PerRPCCredentials`
4. Gateway enforces RBAC (admin/user roles) and workspace membership

The BFF does NOT perform OIDC validation, token exchange, or refresh. Those are the auth proxy's job.

## Configuration

CLI flags with env var fallbacks:

| Flag | Env Var | Description |
|------|---------|-------------|
| `-port` | `PORT` | Listen port (default 8080) |
| `-gateway-url` | `OPENSHELL_GATEWAY_URL` | Gateway gRPC endpoint |
| `-gateway-ca-cert` | `GATEWAY_CA_CERT` | CA cert for gateway TLS |
| `-static-dir` | `STATIC_DIR` | Frontend static assets directory |
| `-auth-disabled` | `AUTH_DISABLED` | Skip auth — dev only (default false) |
| `-auth-token-header` | `AUTH_TOKEN_HEADER` | Auth proxy token header (default x-forwarded-access-token) |
| `-auth-user-header` | `AUTH_USER_HEADER` | Auth proxy user header (default x-auth-request-user) |
| `-allowed-origins` | `ALLOWED_ORIGINS` | Comma-separated CORS origins (default empty) |

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

## Proto regeneration

```bash
make proto  # runs protoc on backend/proto/*.proto → backend/gen/
```

Proto files are copied from `NVIDIA/OpenShell/proto/`. Keep them in sync manually or via CI check.
