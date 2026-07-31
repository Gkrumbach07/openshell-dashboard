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

# Point at your OpenShell source checkout
export OPENSHELL_DIR=~/path/to/openshell

# Start the infrastructure (Keycloak + gateway)
./scripts/dev-env.sh start

# Run the dashboard with the printed env vars
export OPENSHELL_GATEWAY_URL=grpcs://localhost:17670
export OIDC_ISSUER=http://localhost:8180/realms/openshell
export OIDC_CLIENT_ID=openshell-dashboard
export GATEWAY_CA_CERT=$(pwd)/scripts/.pki/ca.crt
export AUTH_DISABLED=false
make dev
```

Open http://localhost:3000 and log in via Keycloak with one of the test users:

| User | Password | Role |
|------|----------|------|
| `admin@test` | `admin` | Platform admin (full access) |
| `user@test` | `user` | Workspace member |
| `user-b@test` | `user-b` | Workspace member |

The script is idempotent. Run `./scripts/dev-env.sh status` to check components, `stop` to tear down, or `rebuild-gateway` after pulling upstream changes.

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

OIDC only (no mTLS, no OpenShift OAuth). The frontend runs an Authorization Code + PKCE flow against your IdP, stores the ID token in sessionStorage, and sends it as `Authorization: Bearer` to the BFF. The BFF validates the JWT (issuer JWKS via `go-oidc`) and forwards the same token to the gateway on every gRPC call: the gateway makes all RBAC decisions.

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
