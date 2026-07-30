# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell) — the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway over gRPC.

- **Workspaces** — create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes** — list, create (with required security policy), inspect, delete
- **Providers** — register inference/service credentials from provider profiles
- **Gateway** — status, version, compute drivers

The frontend's page components are self-contained and exported (`openshell-dashboard/pages`) so downstream platforms can import and wrap them.

## Quick start (local dev)

Prereqs: Go 1.22+, Node 20+, `protoc` (only needed to regenerate stubs), and a running OpenShell gateway (`openshell gateway start`).

```bash
make setup                                # npm install + go mod download
export OPENSHELL_GATEWAY_URL=localhost:50051   # your gateway gRPC endpoint
make dev
```

`make dev` starts two processes:

| Process | Port | Notes |
|---------|------|-------|
| Webpack dev server | http://localhost:3000 | proxies `/api` → BFF |
| Go BFF | http://localhost:8080 | runs with `AUTH_DISABLED=true` by default in dev |

Open http://localhost:3000, click **Continue as developer**, and you're in. Set `AUTH_DISABLED=false` plus the OIDC env vars to exercise the real login flow.

## Configuration

All flags have env var fallbacks:

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `-port` | `PORT` | `8080` | BFF listen port |
| `-gateway-url` | `OPENSHELL_GATEWAY_URL` | `localhost:50051` | Gateway gRPC endpoint (`grpcs://` prefix for TLS) |
| `-oidc-issuer` | `OIDC_ISSUER` | — | OIDC issuer URL |
| `-oidc-client-id` | `OIDC_CLIENT_ID` | — | OIDC client ID (public client, PKCE) |
| `-static-dir` | `STATIC_DIR` | — | Serve built frontend from this directory |
| `-auth-disabled` | `AUTH_DISABLED` | `false` | Skip OIDC validation — **dev only** |
| `-allowed-origins` | `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS origins |

## Auth

OIDC only (no mTLS, no OpenShift OAuth). The frontend runs an Authorization Code + PKCE flow against your IdP, stores the ID token in sessionStorage, and sends it as `Authorization: Bearer` to the BFF. The BFF validates the JWT (issuer JWKS via `go-oidc`) and forwards the same token to the gateway on every gRPC call — the gateway makes all RBAC decisions.

## Make targets

```bash
make setup      # install frontend + backend deps
make proto      # regenerate Go stubs from backend/proto/*.proto
make dev        # frontend dev server (:3000) + BFF (:8080)
make build      # docker image (multi-stage: frontend + Go binary)
make test       # jest + go test
make lint       # eslint + go vet
make typecheck  # tsc --noEmit
```

## Container / compose

```bash
make build
docker run -p 8080:8080 -e OPENSHELL_GATEWAY_URL=host.docker.internal:50051 -e AUTH_DISABLED=true openshell-dashboard:latest
```

`deploy/docker-compose.yml` runs the dashboard plus a Keycloak dev instance for OIDC testing.

## Architecture

```
Browser ── REST ──► Go BFF ── gRPC (bearer) ──► OpenShell gateway
           (React Query)     (protoc-generated stubs, thin wrapper)
```

- **Proto is source of truth.** `backend/proto/` is copied from `NVIDIA/OpenShell/proto/`; `make proto` regenerates `backend/gen/`. Wrappers in `backend/internal/gateway/` cover the Phase 1 user-facing RPCs only.
- **No WebSockets** — status uses polling (5s via React Query `refetchInterval`).
- **Secrets never reach the browser** — provider credentials are write-only; the BFF serializes only credential key names.
- **No sandbox stop/start** — the OpenShell lifecycle is create → ready/error → delete. The UI reflects the API as-is.
- Sandbox **policy is required at create** — the form ships client-side starter templates (the gateway has no server-side policy library).

See `CLAUDE.md` and `.claude/rules/` for contributor conventions.
