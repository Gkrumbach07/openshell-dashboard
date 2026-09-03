# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell), the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway through the official Go SDK.

- **Workspaces**: create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes**: list, create (with required security policy), inspect, delete
- **Providers**: register inference/service credentials from provider profiles
- **Gateway**: status, version, compute drivers

The frontend's page components are self-contained and exported (`openshell-dashboard/pages`) so downstream platforms can import and wrap them.

UI copy goes through an English-only i18n layer (`openshell-dashboard/i18n`; contract in [ADR 0004](docs/adrs/0004-downstream-consumption-i18n.md)). See [`frontend/src/i18n/README.md`](frontend/src/i18n/README.md) for contributor usage and how hosts can override strings or add locales.

## Quick start (local dev)

Prereqs: Go 1.25.1+, Node 20+, and a running OpenShell gateway (`openshell gateway start`).

```bash
make setup                                # npm install + go mod download
export OPENSHELL_GATEWAY_URL=localhost:50051   # your gateway gRPC endpoint
make dev
```

`make dev` starts two processes:

| Process | Port | Notes |
|---------|------|-------|
| Vite dev server | http://localhost:3000 | proxies `/api` → BFF |
| Go BFF | http://localhost:8080 | runs with `AUTH_DISABLED=true` by default in dev |

Open http://localhost:3000, click **Continue as developer**, and you're in.

### Local dev with an OIDC gateway (full stack)

To develop against a gateway that has real OIDC configured (Keycloak), use the included dev environment script. This sets up self-signed TLS, a Keycloak instance in Podman, and builds the gateway from source. The dashboard itself runs in dev mode (the gateway allows unauthenticated calls locally); Keycloak mints real JWTs for exercising the Bearer relay path with curl or the OpenShell CLI. To test the full browser-auth flow, put oauth2-proxy in front of the BFF (see Auth below).

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
| Dashboard frontend | Vite dev server on port 3000 | Runs with `make dev`, Ctrl+C to stop |

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
| `-listen-address` | `LISTEN_ADDRESS` | | BFF listen address; empty binds all interfaces |
| `-gateway-url` | `OPENSHELL_GATEWAY_URL` | `localhost:50051` | Gateway gRPC endpoint (`grpcs://` prefix for TLS) |
| `-static-dir` | `STATIC_DIR` |: | Serve built frontend from this directory |
| `-auth-disabled` | `AUTH_DISABLED` | `false` | Skip auth: **dev only** |
| `-auth-token-header` | `AUTH_TOKEN_HEADER` | `x-forwarded-access-token` | Header the auth proxy injects the bearer into |
| `-auth-user-header` | `AUTH_USER_HEADER` | `x-auth-request-user` | Header the auth proxy injects the username into |
| `-admin-role` | `ADMIN_ROLE` | `admin` | Role name the frontend treats as platform admin (display gating only) |
| `-logout-url` | `LOGOUT_URL` | `/oauth2/sign_out` | Auth proxy sign-out URL the frontend redirects to on logout |
| `-gateway-ca-cert` | `GATEWAY_CA_CERT` |: | Path to CA cert for self-signed gateway TLS |
| `-gateway-client-cert` | `GATEWAY_CLIENT_CERT` | | Path to client certificate for gateway mTLS |
| `-gateway-client-key` | `GATEWAY_CLIENT_KEY` | | Path to client private key for gateway mTLS |

The browser connects to the dashboard BFF over HTTP or HTTPS. The BFF then
connects separately, as a gRPC client, to the OpenShell gateway's
administrative API. These are independent security boundaries: browser
authentication protects access to the dashboard, while gateway TLS protects
the BFF-to-gateway connection.

The default local OpenShell gateway requires mutual TLS on its loopback-only
administrative listener. Run the BFF on the gateway host and configure the
gateway CA, client certificate, and client key as shown below. Do not point the
BFF at the gateway listener reachable from sandbox containers; that listener
is reserved for sandbox callbacks and is not the administrative API.

```bash
./openshell-dashboard \
  -listen-address 127.0.0.1 \
  -gateway-url https://localhost:17670 \
  -gateway-ca-cert "$HOME/.config/openshell/gateways/openshell/mtls/ca.crt" \
  -gateway-client-cert "$HOME/.config/openshell/gateways/openshell/mtls/tls.crt" \
  -gateway-client-key "$HOME/.config/openshell/gateways/openshell/mtls/tls.key" \
  -auth-disabled
```

Package-managed OpenShell installations generate this client bundle
automatically under `~/.config/openshell/gateways/<gateway-name>/mtls/`. See
OpenShell's [gateway authentication reference](https://github.com/NVIDIA/OpenShell/blob/main/docs/reference/gateway-auth.mdx)
and [installation guide](https://github.com/NVIDIA/OpenShell/blob/main/docs/about/installation.mdx).
Operators running a gateway manually or in a container can create the bundle
with the documented [`generate-certs` flow](https://github.com/NVIDIA/OpenShell/blob/main/docs/about/container-gateway.mdx#full-mtls-setup).

The BFF can also manage a remote OpenShell gateway by setting `-gateway-url`
to a deliberately exposed administrative endpoint. The gateway's server
certificate must cover that hostname, and the gateway must trust the BFF's
client certificate. Mutual TLS is especially important across a network: it
encrypts the administrative traffic, authenticates the gateway to the BFF,
and authenticates the BFF to the gateway. Restrict network access to the
endpoint and place an authentication proxy in front of the BFF for browser
users; mutual TLS does not replace user authentication or gateway RBAC.

## Auth

**The BFF is a token relay.** It runs no OIDC flows, holds no sessions, and
never validates tokens. Browser authentication is owned by an auth proxy in
front of it; the BFF reads the bearer the proxy injects
(`x-forwarded-access-token`, configurable) — or an explicit `Authorization:
Bearer` from API clients — and forwards it to the gateway on every gRPC
call. The gateway validates the JWT against its own OIDC JWKS and makes all
RBAC decisions.

- **Production / standalone with auth:** run [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
  (or kube-auth-proxy on OpenShift) in front of the BFF, registered as an
  OIDC client with the **same IdP the gateway trusts**, with an audience the
  gateway accepts. oauth2-proxy handles login, cookie sessions, refresh, and
  sign-out (`/oauth2/sign_out` — the BFF's default `LOGOUT_URL`), and it
  authenticates WebSocket upgrades (the terminal) like any other request.
  The secure-agent-workspace validated pattern ships exactly this setup.
  **Deployment requirement:** the BFF must only be reachable through the
  proxy — anything that can reach the BFF directly can present any header.

  A verified sidecar configuration (Dex as IdP, gateway audience =
  `client_id`):

  ```
  --provider=oidc
  --oidc-issuer-url=https://<idp>            # same issuer the gateway trusts
  --client-id=openshell-dashboard            # must match the gateway's audience
  --redirect-url=https://<dashboard-host>/oauth2/callback
  --upstream=http://127.0.0.1:8080/          # the BFF
  --http-address=0.0.0.0:4180                # point the Service/Route here
  --scope=openid profile email groups
  --pass-authorization-header=true           # forwards the ID token as the bearer
  --pass-user-headers=true                   # then set AUTH_USER_HEADER=x-forwarded-user
  --email-domain=*
  --reverse-proxy=true
  --insecure-oidc-allow-unverified-email     # needed for IdPs that map a username
                                             # into the email claim without
                                             # email_verified (e.g. Dex's
                                             # OpenShift connector)
  ```

  Note the client must be **confidential** (oauth2-proxy requires a client
  secret) — a PKCE-only public client registration is not enough.

  The RHOAI/OpenShell POC's sanitized Dex configuration, including its separate
  public embed client, is documented in
  [`deploy/openshift/dex/`](deploy/openshift/dex/README.md).
- **Dev** (`AUTH_DISABLED=true`): no auth, synthetic dev-user, no tokens
  forwarded. `make dev-full` runs the gateway with unauthenticated calls
  allowed; Keycloak still mints real JWTs for exercising the Bearer relay
  path with curl or the CLI.

See `docs/adrs/0002-auth-relay-only-bff.md` for the full design.

## Make targets

```bash
make setup      # install frontend + backend deps
make dev        # frontend dev server (:3000) + BFF (:8080)
make dev-full   # start Keycloak + gateway, then run dev (full OIDC stack)
make build      # docker image (multi-stage: frontend + Go binary)
make test       # jest + go test
make lint       # eslint + golangci-lint + prettier
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
           (React Query)     (OpenShell Go SDK)
```

- **The vendored Go SDK is the source of truth.** Handlers call `github.com/NVIDIA/OpenShell/sdk/go` directly. The only remaining low-level escape hatch is `backend/internal/sdkclient/rawexec.go` for binary-safe file uploads, because the public SDK still lacks a non-TTY exec API that accepts raw stdin bytes.
- **Polling for status**: sandbox state uses polling (5s via React Query `refetchInterval`). WebSockets are used only for the interactive terminal.
- **Secrets never reach the browser**: provider credentials are write-only; the BFF serializes only credential key names.
- **Sandbox stop/start** (OpenShell v0.0.113+): the lifecycle is create → ready/error → (stop ⇄ start) → delete. Stopping retains persistent state; there is still no suspend/restart. The UI reflects the API as-is.
- Sandbox **policy is required at create**: the form ships client-side starter templates (the gateway has no server-side policy library).

See `CLAUDE.md` and `.claude/rules/` for contributor conventions.
