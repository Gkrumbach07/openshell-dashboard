# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell), the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway over gRPC.

- **Workspaces**: create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes**: list, create (with required security policy), inspect, delete
- **Providers**: register inference/service credentials from provider profiles
- **Gateway**: status, version, compute drivers

The frontend's page components are self-contained and exported (`openshell-dashboard/pages`) so downstream platforms can import and wrap them.

## Library / npm package

Build the publishable package from `frontend/`:

```bash
cd frontend && npm run build:lib
```

That emits JS, type declarations, and **package-owned** co-located styles (and other relative static assets imported by lib modules) under `frontend/dist/`. The `"files"` field publishes `dist` only—consumers do not need `src/`.

- Import pages/components as usual (`openshell-dashboard/pages`, `openshell-dashboard/components`, …). Your bundler must handle CSS imports from those modules (same requirement as loading PatternFly CSS).
- Host apps still supply PatternFly (and other peer) stylesheets. Dependency CSS is not copied into `dist/`.
- There is no separate CSS package export in v1; styles ship next to the compiled modules that import them.

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

Open http://localhost:3000, click **Continue as developer**, and you're in.

### Local dev with OIDC (full auth stack)

To test with real OIDC authentication against a local Keycloak and OpenShell gateway, use the included dev environment script. This sets up self-signed TLS, a Keycloak instance in Podman, and builds the gateway from source.

**Additional prereqs:** Podman (with `podman machine start` on macOS), Rust toolchain (`cargo`), and the [OpenShell](https://github.com/NVIDIA/OpenShell) repo cloned locally.

```bash
make setup
export OPENSHELL_DIR=~/path/to/openshell    # your OpenShell checkout
make dev-full                                # starts infra + dashboard
```

That's it. `dev-full` starts Keycloak and the gateway (if not already running), writes a `scripts/.env.dev` config file, and launches the dashboard. On subsequent runs, `make dev` picks up the config automatically (no env vars needed).

If `OPENSHELL_DIR` is not set, the script prompts interactively and offers to clone the repo for you. The chosen path is saved to `scripts/.env.dev` so you only configure it once.

Open http://localhost:3000 and log in via Keycloak with one of the test users:

| User | Password | Role |
|------|----------|------|
| `admin@test` | `admin` | Platform admin (full access) |
| `user@test` | `user` | Workspace member |
| `user-b@test` | `user-b` | Workspace member |

### What `dev-full` starts

| Component | How | Lifecycle |
|-----------|-----|-----------|
| Keycloak | Podman container (`openshell-keycloak`) on port 8180 | Runs until `dev-env.sh stop` |
| OpenShell gateway | Background process built from source, port 17670 (gRPCs) + 17671 (health) | Runs until `dev-env.sh stop` |
| Dashboard BFF | `go run` on port 8080 | Runs with `make dev`, Ctrl+C to stop |
| Dashboard frontend | Webpack dev server on port 3000 | Runs with `make dev`, Ctrl+C to stop |

Keycloak and the gateway survive across `make dev` restarts. Stop them explicitly:

```bash
./scripts/dev-env.sh stop       # stops gateway + keycloak, cleans up orphans
./scripts/dev-env.sh status     # check what's running
./scripts/dev-env.sh rebuild-gateway  # rebuild after upstream changes
```

## Configuration

All flags have env var fallbacks:

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `-port` | `PORT` | `8080` | BFF listen port |
| `-gateway-url` | `OPENSHELL_GATEWAY_URL` | `localhost:50051` | Gateway gRPC endpoint (`grpcs://` prefix for TLS) |
| | `OIDC_ISSUER` |: | OIDC issuer URL (enables standalone mode) |
| | `OIDC_CLIENT_ID` |: | OIDC client ID |
| | `OIDC_CLIENT_SECRET` |: | Optional client secret. Without it the BFF is a public client (PKCE only) |
| | `OIDC_SCOPES` | `openid profile email groups` | Requested scopes. `groups` is Keycloak/Dex-shaped; Entra ID rejects it — override for other IdPs |
| | `SESSION_SECRET` |: | Key for encrypted session cookies (standalone OIDC). **Required** unless `DEPLOYMENT_CONTEXT=dev` — the BFF fails closed without it |
| | `DEPLOYMENT_CONTEXT` | `standalone` | `dev` permits an ephemeral session secret for local use |
| `-static-dir` | `STATIC_DIR` |: | Serve built frontend from this directory |
| `-auth-disabled` | `AUTH_DISABLED` | `false` | Skip auth: **dev only** |
| `-gateway-ca-cert` | `GATEWAY_CA_CERT` |: | Path to CA cert for self-signed gateway TLS |
| `-allowed-origins` | `ALLOWED_ORIGINS` |: | Comma-separated extra CORS/WebSocket origins (same-origin is always allowed) |

## Auth

OIDC only (no mTLS, no OpenShift OAuth). Three modes, one middleware:

- **Standalone OIDC** (`OIDC_ISSUER` + `OIDC_CLIENT_ID` set): the frontend runs an Authorization Code + PKCE flow against your IdP; the BFF exchanges the code server-side and seals the tokens into an encrypted, HttpOnly session cookie (`__Host-openshell-session`). The browser never sees a token, and the cookie authenticates everything — REST calls and the terminal's WebSocket handshake alike. Expired sessions are refreshed against the IdP transparently, server-side (requires the IdP to issue a refresh token — some providers need `offline_access` added to `OIDC_SCOPES`), up to a 12h absolute lifetime. Any spec-compliant OIDC provider works, but defaults are Keycloak/Dex-shaped: adjust `OIDC_SCOPES` for IdPs without a `groups` scope (e.g. Entra ID), register the BFF as a confidential client and set `OIDC_CLIENT_SECRET` where possible, and ensure the **gateway's configured audience matches `OIDC_CLIENT_ID`** — the BFF forwards the ID token as the bearer, and the gateway validates its `aud` against the client ID.
- **Federated** (behind oauth2-proxy / kube-auth-proxy): the proxy injects the user's token as `x-forwarded-access-token`; the BFF forwards it.
- **Dev** (`AUTH_DISABLED=true`): no auth, synthetic dev-user, no tokens forwarded.

The BFF never validates JWTs — it forwards the bearer to the gateway on every gRPC call, and the gateway makes all RBAC decisions. See `docs/adrs/0010-cookie-session-standalone-auth.md` for the full design.

## Make targets

```bash
make setup      # install frontend + backend deps
make proto      # regenerate Go stubs from backend/proto/*.proto
make dev        # frontend dev server (:3000) + BFF (:8080)
make dev-full   # start Keycloak + gateway, then run dev (full OIDC stack)
make build      # docker image (multi-stage: frontend + Go binary)
make test       # jest + go test
make lint       # eslint + go vet
make typecheck  # tsc --noEmit
```

## Container image

```bash
make build
podman run -p 8080:8080 \
  -e OPENSHELL_GATEWAY_URL=host.containers.internal:50051 \
  -e AUTH_DISABLED=true \
  openshell-dashboard:latest
```

For local OIDC testing without containers, use `./scripts/dev-env.sh start` instead (see above).

## Architecture

```
Browser ── REST ──► Go BFF ── gRPC (bearer) ──► OpenShell gateway
           (React Query)     (protoc-generated stubs, thin wrapper)
```

- **Proto is source of truth.** `backend/proto/` is copied from `NVIDIA/OpenShell/proto/`; `make proto` regenerates `backend/gen/`. Wrappers in `backend/internal/gateway/` cover the Phase 1 user-facing RPCs only.
- **No WebSockets**: status uses polling (5s via React Query `refetchInterval`).
- **Secrets never reach the browser**: provider credentials are write-only; the BFF serializes only credential key names.
- **No sandbox stop/start**: the OpenShell lifecycle is create → ready/error → delete. The UI reflects the API as-is.
- Sandbox **policy is required at create**: the form ships client-side starter templates (the gateway has no server-side policy library).

See `CLAUDE.md` and `.claude/rules/` for contributor conventions.
