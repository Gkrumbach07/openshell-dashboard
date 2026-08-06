# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell), the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway over gRPC.

- **Workspaces**: create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes**: list, create (with required security policy), inspect, delete
- **Providers**: register inference/service credentials from provider profiles
- **Gateway**: status, version, compute drivers

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
| `-oidc-issuer` | `OIDC_ISSUER` |: | OIDC issuer URL |
| `-oidc-client-id` | `OIDC_CLIENT_ID` |: | OIDC client ID (public client, PKCE) |
| `-static-dir` | `STATIC_DIR` |: | Serve built frontend from this directory |
| `-auth-disabled` | `AUTH_DISABLED` | `false` | Skip OIDC validation: **dev only** |
| `-gateway-ca-cert` | `GATEWAY_CA_CERT` |: | Path to CA cert for self-signed gateway TLS |
| `-allowed-origins` | `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS origins |

## Auth

OIDC only (no mTLS, no OpenShift OAuth). The frontend runs an Authorization Code + PKCE flow against your IdP, stores the ID token in sessionStorage, and sends it as `Authorization: Bearer` to the BFF. For terminal WebSocket handshakes, the BFF also sets a secure, HttpOnly, strict same-site cookie that is accepted only on WebSocket upgrades. The BFF validates the JWT (issuer JWKS via `go-oidc`) and forwards the same token to the gateway on every gRPC call: the gateway makes all RBAC decisions.

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
