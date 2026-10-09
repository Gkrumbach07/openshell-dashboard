# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell), the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway through the official Go SDK.

- **Workspaces**: create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes**: list, create (with required security policy), inspect, delete
- **Providers**: register inference/service credentials from provider profiles
- **Gateway**: status, version, compute drivers

The dashboard ships as a [container image](#container-image) and a Helm chart ([`deploy/helm/openshell-dashboard`](deploy/helm/openshell-dashboard)). It is no longer published as an npm package: the versions of `openshell-dashboard` already on npm stay there, and a release from `main` no longer adds one ([ADR 0008](docs/adrs/0008-retire-the-npm-package.md)).

UI copy goes through an English-only i18n layer ([`frontend/src/i18n`](frontend/src/i18n); contract in [ADR 0004](docs/adrs/0004-downstream-consumption-i18n.md)). See [`frontend/src/i18n/README.md`](frontend/src/i18n/README.md) for contributor usage and how to override strings or add locales.

## Compatibility

A dashboard build is for one **minor release line** of the OpenShell gateway, never for "whatever is latest". A line is every gateway release that shares a major and a minor number: `0.1.x` is `0.1.0`, `0.1.3`, and every other release whose version starts with `0.1`. To know whether a build works with a gateway, compare the gateway's first two version numbers with the line the build is for; the patch number plays no part ([ADR 0009](docs/adrs/0009-console-release-policy.md)).

The build reaches the gateway through one pinned Go SDK. It is built on one gateway release of its line and [tested against that gateway](#gateway-compatibility-testing) on every pull request, and for the rest of the line it relies on OpenShell making no breaking change to a Stable interface within a minor release line. On another line you do not get a clean error. You get `workspace '\n\adefault' not found` on every workspace-scoped call, or `workspace_scope is required`, or no error at all and the wrong workspace. The dashboard shows a notice that names its line and the version the gateway reports.

### What this branch supports

<!-- gateway-range:begin (generated from deploy/ci/gateway-pins.json by scripts/readme-gateway-range.mjs; do not edit) -->
| | |
|---|---|
| Supported gateways | `0.1.x` |
| Tested on | `0.1.3` |
| OpenShell Go SDK | `v0.0.0-20261009050449-e1f3c82caa3e` |
<!-- gateway-range:end -->

A release of that line that is not listed under *Tested on* is supported all the same: a later patch, a pre-release, a dev build, a downstream rebuild such as `0.1.2-rhaiv.5`. A gateway on any other line, older or newer, is not, and the notice says so. A gateway that reports no usable version (an unstamped build reports `0.0.0`) gets no verdict and no notice. New gateway releases are [picked up from upstream's tags](#following-upstream): the branch moves to each one as it appears, and pre-releases are tested ahead of it.

### Which dashboard for which gateway

A dashboard release is numbered after the gateway release line it is for: dashboard `X.Y.Z` is for gateway `X.Y.x`. The third number counts the dashboard's own releases on that line and has nothing to do with the gateway's patch number. Nobody chooses a version; it is worked out from the gateway release the branch is built on ([docs/releasing.md](docs/releasing.md#what-decides-the-version)).

| Your gateway | Dashboard | Container image |
|---|---|---|
| on the line above | a release whose first two numbers are that line, cut from `main`. `1.0.0` to `1.2.0` are for gateway `0.1.x` too; they are from before releases were numbered this way | `quay.io/gkrumbach07/openshell-dashboard:<X.Y.Z>`; for `1.1.0` and earlier, the [commit tag](#container-image) |
| `0.0.116` | `0.2.0`, also from before; a maintenance line for it is being set up on the `0.2.x` branch | `quay.io/gkrumbach07/openshell-dashboard:sha-701454a` |

**Do not use dashboard `0.3.0`.** It works correctly with none of these gateways. Against `0.1.0` and newer it fails. Against `0.0.116` it does something worse than fail: it silently ignores the workspace. A sandbox created in workspace `team-a` lands in `default`, every workspace page lists the contents of `default`, and nothing reports an error. Its SDK sends the workspace in a field that gateway `0.0.116` does not have, and a protobuf field the receiver does not know is ignored without complaint.

No build spans `0.0.116` and `0.1.x`. 1.x against `0.0.116` fails every workspace-scoped call with `workspace '\n\adefault' not found`. `0.2.0` against `0.1.0` or newer fails with `workspace_scope is required` or a bare `internal error`. Gateway `0.0.116` also has no sandbox-template RPCs (it answers them with gRPC `UNIMPLEMENTED`), so sandbox templates do not work against it with any dashboard.

**The releases cut before this numbering do not follow it.** `0.1.3`, `0.2.0`, `0.3.0` and `1.0.0` to `1.2.0` got their numbers automatically from commit messages, so those numbers say nothing about a gateway, and 1.x is not a stability claim: nobody decided that a 1.0 milestone had been reached (see [#78](https://github.com/Gkrumbach07/openshell-dashboard/issues/78)). `1.x` is for gateway `0.1.x`. `0.1.3` and `0.2.0` are not for a gateway `0.1.x` or `0.2.x`: both are built on the SDK for gateway `0.0.116`. For these releases the table above is the only statement there is.

### How the line is established

Nobody types it into an artifact. [`deploy/ci/gateway-pins.json`](deploy/ci/gateway-pins.json) names the one gateway *release* this branch is built on: its gateway and supervisor images, pinned by digest, and the Go SDK at the commit upstream tagged it with. The compat suite ([`backend/test/compat`](backend/test/compat)) runs against that real gateway on every pull request, and CI fails when it does not pass. The line is the major and minor number of that release; [`scripts/gateway-range.mjs`](scripts/gateway-range.mjs) derives it, and everything that states the line calls it:

```bash
node scripts/gateway-range.mjs                    # print the line, the release it is tested on and the SDK
node scripts/gateway-range.mjs --check            # ...and fail unless the line compiled into the BFF and the SDK in backend/go.mod match the pins
node scripts/readme-gateway-range.mjs --write     # regenerate the table above after the pins move
```

The BFF has the line compiled in (`BuiltInGatewayReleaseLine` in [`backend/pkg/models/gateway_release_line.go`](backend/pkg/models/gateway_release_line.go)), so an image knows its line whatever built it and whatever environment it is started with. `--check` holds that constant to the pins: a move to a release on a new minor has to change the constant too, and CI says so when it does not.

CI also fails when the table above is stale. The [workflow that moves the pin](#following-upstream) regenerates it and changes the constant itself; a change to the pins made by hand has to do both. Only the pinned release is run on every pull request; the other releases of the line are covered by the claim but not run.

### Where each artifact says it

Every release cut after `1.2.0` declares the line it was cut for, so you do not need this repository to find out what a given version needs:

| Artifact | Where | How to read it |
|---|---|---|
| The version | its first two numbers are the line | `0.1.4` is for gateway `0.1.x` |
| GitHub release | a *Supported OpenShell gateways* section in the release notes | the [releases page](https://github.com/Gkrumbach07/openshell-dashboard/releases) |
| Container image | labels `io.github.gkrumbach07.openshell-dashboard.gateway.line` and `.sdk` | `skopeo inspect docker://quay.io/gkrumbach07/openshell-dashboard:<tag>` |

Release `1.2.0` was cut when a build declared a range of gateway versions instead, `0.1.0` to `0.1.2`: its notes state the range, and its image carries it as env `GATEWAY_SUPPORTED_MIN` and `GATEWAY_SUPPORTED_MAX` and labels `.gateway.min` and `.gateway.max`. Releases up to and including `1.1.1` declare nothing: their release notes have no such section, and their images carry neither the variables nor the labels. For those, the table under [Which dashboard for which gateway](#which-dashboard-for-which-gateway) is the only statement there is.

## Quick start (local dev)

Prereqs: Go 1.26.7+, Node 20+, and a running OpenShell gateway (`openshell gateway start`).

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

Most server flags have env var fallbacks. `--healthcheck` is probe-only: it checks
`http://127.0.0.1:$PORT/api/v1/healthz` and exits without starting a server.

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
| `-gateway-release-line` | `GATEWAY_RELEASE_LINE` | compiled in | Gateway release line this build is for, written `major.minor`; see [Compatibility](#compatibility). Leave it unset: the default is built into the binary. Override it only for tests and local development. A value that is not a line turns the compatibility notice off. The BFF only informs and never refuses a gateway |
| `-gateway-ca-cert` | `GATEWAY_CA_CERT` |: | Path to CA cert for self-signed gateway TLS |
| `-gateway-client-cert` | `GATEWAY_CLIENT_CERT` | | Path to client certificate for gateway mTLS |
| `-gateway-client-key` | `GATEWAY_CLIENT_KEY` | | Path to client private key for gateway mTLS |
| `-tls-cert` | `TLS_CERT_FILE` | | Path to server certificate for inbound BFF HTTPS |
| `-tls-key` | `TLS_KEY_FILE` | | Path to server private key for inbound BFF HTTPS |

The browser or auth proxy connects to the dashboard BFF over HTTP or HTTPS.
The BFF then connects separately, as a gRPC client, to the OpenShell gateway's
administrative API. These are three independent TLS boundaries:

- **Inbound BFF TLS** — proxy/browser → BFF (`TLS_CERT_FILE` / `TLS_KEY_FILE`).
  When both are set, the BFF serves HTTPS on `PORT`. When neither is set, the
  BFF serves plain HTTP (local dev unchanged). Setting only one fails at startup.
- **Outbound gateway TLS** — BFF → gateway server (`GATEWAY_CA_CERT`).
- **Outbound gateway mTLS** — BFF client identity to the gateway
  (`GATEWAY_CLIENT_CERT` / `GATEWAY_CLIENT_KEY`).

Browser authentication protects access to the dashboard; inbound BFF TLS
encrypts the proxy-to-BFF hop; outbound gateway TLS/mTLS protects the
BFF-to-gateway connection.

For container deployments that require inbound HTTPS, mount cert and key files
and point the env vars at them (paths are examples, not enforced):

```text
/etc/tls/private/tls.crt  → TLS_CERT_FILE
/etc/tls/private/tls.key  → TLS_KEY_FILE
PORT=8843                   # consumer choice; not hardcoded
```

Rotating mounted cert/key files requires restarting the BFF process so it reloads
the paths configured in `TLS_CERT_FILE` and `TLS_KEY_FILE`.

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
make compat     # gateway compatibility suite (needs Docker; see below)
```

## Gateway compatibility testing

The BFF pins its SDK in `backend/go.mod`; the gateway is a separately released
artifact. Those two drift silently — a gateway release can break the dashboard
with no change on our side, which is exactly how the Sep 2026 SDK breaking
changes reached `main` unnoticed.

`backend/test/compat` is the guard: a Go suite that drives the BFF's REST API
against a **real** gateway and asserts the contracts the frontend depends on —
list endpoints returning arrays (not pagination envelopes), the delete outcome
envelope, the policy enum spellings, and a full sandbox lifecycle.

It is build-tagged `compat`, so `go test ./...` never picks it up.

```bash
make compat                              # against the gateway this branch pins, the one CI runs
OPENSHELL_VERSION=0.1.0 make compat      # against another gateway release, by its tag

make compat-up && make compat-down       # manage the stack by hand
```

### The SDK and the gateway are wire-coupled

Bumping `sdk/go` is not a local-only change. The Sep 2026 SDK renumbered
`CreateSandboxRequest`'s protobuf fields — `workspace_scope` moved from field 8
to field 7, where older gateways expect a string. Against an older gateway every
workspace-scoped call then fails with:

```
workspace '\n\adefault' not found
```

That mangled name is the serialized `WorkspaceSelector` (`0A 07 "default"`)
being read as a plain string. So the SDK and the gateway a branch pins come
from one upstream release and move in one change, and the compat suite runs
on the pair.

The gateway's **TOML config is versioned too**, and the schemas are mutually
exclusive — `0.1.0` and newer require v2, releases up to `0.0.116` require v1:

| | v1 (≤ 0.0.116) | v2 (≥ 0.1.0) |
|---|---|---|
| `version` | `1` | `2` |
| compute driver | `compute_drivers = ["docker"]` | `compute_driver = "docker"` |
| `image_pull_policy` | `"IfNotPresent"` | `"if_not_present"` |
| `sandbox_namespace` | supported | removed |

`OPENSHELL_CONFIG_SCHEMA` (`v1`\|`v2`\|`auto`) picks the template in
`deploy/ci/gateway.e2e.*.toml.tmpl`. It defaults to the schema the pins name
for the pinned gateway, and to `v2` for any other.

Two tag gotchas:

- **`latest` is not upstream HEAD.** It is the newest *release*. **`dev`** tracks
  upstream HEAD and is the only tag that keeps pace with `sdk/go@latest`.
- Gateway and supervisor share a tag and must match.

### One gateway per branch

Per [ADR 0005](docs/adrs/0005-gateway-version-compatibility.md), as amended by
[ADR 0006](docs/adrs/0006-compat-links-and-sweep-axes.md) and
[ADR 0009](docs/adrs/0009-console-release-policy.md), a branch is built on one
gateway release and never claims `latest`.
[`deploy/ci/gateway-pins.json`](deploy/ci/gateway-pins.json) names it, and every
change is tested against it, whichever branch it merges into:

| Branch | Pins | A pull request into it |
|---|---|---|
| `main` | a stable release | the default: everything that builds and passes on the released gateway |
| `next` | the upcoming release, a pre-release until upstream cuts the stable one | only work that needs the upcoming release |
| `release/X.Y` | a stable release of the line before `main`'s | critical and security fixes for that line |

`ci.yml` has two checks about the pin, and they mean different things:

| Check | Fails when |
|---|---|
| `compat` | the console does not pass the compat suite against the pinned gateway, or the BFF, started with nothing but the line compiled into it, does not judge that gateway `supported` |
| `pins a stable release` | a pull request into `main` or `release/**` pins a pre-release. That is how the pull request from `next` looks until upstream releases, and it says nothing about compatibility |

The pinned gateway is a release, pinned by digest. A `dev` gateway cannot be
pinned that way: it pulls `ghcr.io/nvidia/openshell/sandbox:dev`, a moving tag,
at runtime, which is how a digest-pinned `dev` gateway turned `main` red on
2026-10-02 with no change on our side.

### Three links, each proven separately

The chain is gateway → SDK → BFF → UI, and no link is inferred from another:

| Link | Proven by |
|---|---|
| **wire:** gateway ↔ SDK | `backend/test/compat` against a real gateway, with `-count=1` |
| **source:** SDK ↔ BFF | the compiler, `go vet` and the unit tests |
| BFF ↔ UI | shipping both from one commit |

A result always names the link it is about: a compile error is a source
migration, and is never reported as a gateway problem. The gateway and the SDK
a branch pins come from one upstream release and move together; whether the
pair works is still proven by running it, not read off the version number.

### Following upstream

Nobody moves the pin by hand. [`follow-upstream.yml`](.github/workflows/follow-upstream.yml)
reads upstream's git tags every hour and picks a target: the newest stable
release (`vX.Y.Z`) above the one `main` pins, or failing that the newest
pre-release (`vX.Y.Z-pre.N`) that leads up to one. Every other tag is ignored.
With a target it does two things:

| | Console | Gateway | Tells you |
|---|---|---|---|
| **check A** | `main`, on the SDK it ships with | the target | whether a console that is installed today keeps working |
| **check B** | `next`, on the target's SDK | the target | whether the move will pass on release day |

**`next`** is the bump pull request, opened early. The workflow creates it from
`main` and keeps it in one shape: `main`, then one commit that moves the pin
(the gateway and supervisor images and the SDK at the tag's commit, together),
then whatever people put on it. When `main` moves it is rebased; when the
target changes the move is folded into that first commit; both end in a
force-push with a lease. Its pull request into `main` is a draft while the
target is a pre-release and ready for review once upstream cuts the stable
release, and CI on that pull request is check B. A stable target on a new
minor also gets `release/<old line>` created from `main` first.

**Check A** runs the compat suite with the BFF as `main` builds it against the
target's gateway. A failure goes to one issue, labelled `compat-migrate`,
rewritten in place and closed when it passes again. When the target is a
stable release on `main`'s own line, a failure means upstream broke a Stable
interface inside a minor release line, and the issue says to report it there.

What needs a person:

- **Merging `next`**, with *Rebase and merge*, once it is ready. Nothing is
  merged automatically unless the repository variable `UPSTREAM_AUTOMERGE` is
  `true`. The merge is followed by an automatic release: the dashboard's next
  patch, or `X.Y.0` when the move starts a new gateway minor
  ([docs/releasing.md](docs/releasing.md)).
- **A conflict.** The workflow regenerates `backend/go.sum` and
  `frontend/package-lock.json` by itself. For anything else it leaves `next`
  exactly as it was and comments once on the pull request, naming the files.
- **Starting CI**, while the workflow uses its default token: GitHub starts no
  workflow for what that token pushes, so close and reopen the `next` pull
  request to run check B. With the `UPSTREAM_BOT_TOKEN` secret it starts by
  itself.

The decisions are plain code with tests, in
[`deploy/ci/upstream/`](deploy/ci/upstream/); its README has the details,
including what each job is allowed to run.

`OPENSHELL_VERSION` selects the gateway *and* supervisor tag for a local run —
they are released together and must match. The community sandbox image
publishes no semver tags, so it is pinned separately via `COMPAT_SANDBOX_IMAGE`
and deliberately does not move with the gateway.

> Local runs need a Docker-compatible socket at `/var/run/docker.sock`. Rootless
> Podman on macOS does not satisfy the gateway's Docker driver out of the box —
> override with `DOCKER_SOCK` and `OPENSHELL_STATE_DIR` if your setup differs.

## Container image

CI publishes `quay.io/gkrumbach07/openshell-dashboard` (linux/amd64 and linux/arm64). The image is built once per commit; every other tag is that same image, retagged by digest:

| Tag | Points at | Moves when |
|---|---|---|
| `X.Y.Z` | the image built for the commit released as `vX.Y.Z` | never: it is written once, and the retag refuses to point it anywhere else |
| `X.Y` | the newest `X.Y.z` release: the newest dashboard for gateway `X.Y.x` | a release of that line is cut, from `main` or from `release/X.Y`. No other release moves it |
| `latest` | the newest commit on `main` that passed **every** CI job, including the compat suite against the pinned gateway, while it was the tip of `main` | CI goes green on the tip of `main`; it only moves forward, so re-running an older run does not pull it back. A release does not move it |
| `sha-<7>` | the image built for that commit, whether or not its checks passed | only when CI is re-run in full for that commit, which builds it again |
| `pr-<n>` | the latest build of that pull request | the PR is updated |

Version tags are created automatically starting with the first release cut after `1.1.1`. `1.1.1` itself was tagged once by hand (`1.1.1` is the same image as `sha-9fbdc37`, and like every release before the automation it declares no gateway range). Releases before it have no `X.Y.Z` or `X.Y` tag and never get one automatically. What exists for them is the commit tag, `sha-` plus the first seven characters of the released commit. The ones you are likely to need:

| Release | Image tag |
|---|---|
| `1.1.1` | `1.1.1` (also `sha-9fbdc37`) |
| `1.1.0` | `sha-71335e5` |
| `0.3.0` | `sha-978bcb5` ([do not use](#which-dashboard-for-which-gateway)) |
| `0.2.0` | `sha-701454a` |

For a deployment, pin `X.Y.Z` (or the commit tag, for a release in the table above) and check it against your gateway in [Compatibility](#compatibility). How releases are cut and numbered is in [docs/releasing.md](docs/releasing.md).

A running dashboard does not show a version number, because its image is built before a release is cut and only given more tags afterwards. **Help → About** shows the gateway release line the build is for and, for an image CI built, the first seven characters of the commit it is built from: the same ones as in its `sha-<7>` tag.

To build it yourself:

```bash
make build
podman run -p 8080:8080 \
  -e OPENSHELL_GATEWAY_URL=host.containers.internal:50051 \
  -e AUTH_DISABLED=true \
  openshell-dashboard:latest
```

A plain build like this passes no build args, so the image's `gateway.line` and `sdk` labels are empty and the About dialog shows no commit; CI fills the labels in from `node scripts/gateway-range.mjs` and passes the commit it builds as `DASHBOARD_COMMIT`. The BFF inside does not depend on any of them: its gateway release line is compiled in, so the compatibility notice and the line in the About dialog work in this image as in a published one.

For local OIDC testing without containers, use `./scripts/dev-env.sh start` instead (see above).

## Architecture

```
Browser ── REST ──► Go BFF ── gRPC (bearer) ──► OpenShell gateway
           (React Query)     (OpenShell Go SDK)
```

- **The vendored Go SDK is the source of truth.** Handlers call `github.com/NVIDIA/OpenShell/sdk/go` directly. Three low-level escape hatches remain in `backend/pkg/clients`, each for a gap in the public SDK: `rawexec.go` for binary-safe file uploads, because the SDK lacks a non-TTY exec API that accepts raw stdin bytes, `rawprovider.go` for the keys of the credentials a provider holds, because the SDK drops the map the gateway returns them in, and `rawprofile.go` for provider profiles, because the SDK carries a host, a port and a protocol of each profile endpoint and drops the access preset, enforcement and L7 rules that bound a provider's traffic.
- **Polling for status**: sandbox state uses polling (5s via React Query `refetchInterval`). WebSockets are used only for the interactive terminal.
- **Secrets never reach the browser**: provider credentials are write-only; the BFF serializes only credential key names.
- **Sandbox stop/start** (OpenShell v0.0.113+): the lifecycle is create → ready/error → (stop ⇄ start) → delete. Stopping retains persistent state; there is still no suspend/restart. The UI reflects the API as-is.
- Sandbox **policy is required at create**: the form ships client-side starter templates (the gateway has no server-side policy library).

See `CLAUDE.md` and `.claude/rules/` for contributor conventions.
