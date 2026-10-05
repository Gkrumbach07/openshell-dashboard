# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell), the open-source agent sandboxing platform. Go BFF + React (PatternFly 6) frontend, talking to the OpenShell gateway through the official Go SDK.

- **Workspaces**: create, browse, delete; manage members (OIDC subject + role)
- **Sandboxes**: list, create (with required security policy), inspect, delete
- **Providers**: register inference/service credentials from provider profiles
- **Gateway**: status, version, compute drivers

The frontend's page components are self-contained and exported (`openshell-dashboard/pages`) so downstream platforms can import and wrap them.

UI copy goes through an English-only i18n layer (`openshell-dashboard/i18n`; contract in [ADR 0004](docs/adrs/0004-downstream-consumption-i18n.md)). See [`frontend/src/i18n/README.md`](frontend/src/i18n/README.md) for contributor usage and how hosts can override strings or add locales.

## Compatibility

A dashboard build works with a **range** of OpenShell gateway releases, never with "whatever is latest". It reaches the gateway through one pinned Go SDK, and whether that SDK and a given gateway understand each other is [proven for the pair](#the-sdk-and-the-gateway-are-wire-coupled), not read off their version numbers. Outside the range you do not get a clean error. You get `workspace '\n\adefault' not found` on every workspace-scoped call, or `workspace_scope is required`, or no error at all and the wrong workspace.

### What this branch supports

<!-- gateway-range:begin (generated from deploy/ci/gateway-pins.json by scripts/readme-gateway-range.mjs; do not edit) -->
| | |
|---|---|
| Oldest supported gateway | `0.1.0` |
| Newest tested gateway | `0.1.2` |
| Declared as | `>=0.1.0 <=0.1.2` |
| OpenShell Go SDK | `v0.0.0-20260928030816-6648bd0c290e` |
<!-- gateway-range:end -->

A gateway newer than the newest tested one is *untested by this build*, not known to be broken. The weekly [compat sweep](#two-jobs-two-questions) looks ahead, and raising the ceiling is a deliberate change.

### Which dashboard for which gateway

| Your gateway | Dashboard | npm | Container image |
|---|---|---|---|
| in the range above | **1.x**, the current line, released from `main` | `openshell-dashboard@1` | `quay.io/gkrumbach07/openshell-dashboard:<X.Y.Z>`; for `1.1.0` and earlier, the [commit tag](#container-image) |
| `0.0.116` | **0.2.x**: `v0.2.0` today; a 0.2.x maintenance line is being set up | `openshell-dashboard@0.2.0` | `quay.io/gkrumbach07/openshell-dashboard:sha-701454a` |

**Do not use dashboard `0.3.0`.** It works correctly with none of these gateways. Against `0.1.0` and newer it fails. Against `0.0.116` it does something worse than fail: it silently ignores the workspace. A sandbox created in workspace `team-a` lands in `default`, every workspace page lists the contents of `default`, and nothing reports an error. Its SDK sends the workspace in a field that gateway `0.0.116` does not have, and a protobuf field the receiver does not know is ignored without complaint.

No build spans `0.0.116` and `0.1.x`. 1.x against `0.0.116` fails every workspace-scoped call with `workspace '\n\adefault' not found`. `0.2.0` against `0.1.0` or newer fails with `workspace_scope is required` or a bare `internal error`. Gateway `0.0.116` also has no sandbox-template RPCs (it answers them with gRPC `UNIMPLEMENTED`), so sandbox templates do not work against it with any dashboard.

**1.x is not a stability claim.** The version numbers were assigned automatically from commit messages; nobody decided that a 1.0 milestone had been reached (see [#78](https://github.com/Gkrumbach07/openshell-dashboard/issues/78)). The package will be renamed, with a fresh version history, when the repository moves to another organisation.

### How the range is established

Nobody types it. [`deploy/ci/gateway-pins.json`](deploy/ci/gateway-pins.json) lists gateway *releases*, pinned by digest. Every lane marked `required` runs the compat suite ([`backend/test/compat`](backend/test/compat)) against that real gateway on every pull request, and CI fails when it does not pass. The floor is the lowest required lane and the ceiling is the highest; [`scripts/gateway-range.mjs`](scripts/gateway-range.mjs) derives both, and everything that states the range calls it:

```bash
node scripts/gateway-range.mjs                    # print the range
node scripts/gateway-range.mjs --check            # ...and fail unless the pins' sdk field is the SDK in backend/go.mod
node scripts/readme-gateway-range.mjs --write     # regenerate the table above after the pins move
```

CI fails when that table is stale. The [compat sweep](#the-sweep-has-two-axes)'s automated pull requests regenerate it themselves; a pull request that changes the pins by hand has to run `--write` too. Only the two ends of the range run on every pull request; a release between them is covered by the claim but not re-run each time.

### Where each artifact says it

Starting with the first release cut after `1.1.1`, every release declares the range it was cut with, so you do not need this repository to find out what a given version needs:

| Artifact | Where | How to read it |
|---|---|---|
| GitHub release | a *Supported OpenShell gateways* section in the release notes | the [releases page](https://github.com/Gkrumbach07/openshell-dashboard/releases) |
| npm package | `openshell.gateway` (a semver range) and `openshell.sdk` in `package.json` | `npm view openshell-dashboard@<version> openshell` |
| Container image | env `GATEWAY_SUPPORTED_MIN` and `GATEWAY_SUPPORTED_MAX`; labels `io.github.gkrumbach07.openshell-dashboard.gateway.min`, `.gateway.max` and `.sdk` | `skopeo inspect docker://quay.io/gkrumbach07/openshell-dashboard:<tag>` |

Releases up to and including `1.1.1` predate this and declare nothing: their release notes have no such section, their package has no `openshell` field, and their images carry neither the variables nor the labels. For those, the table under [Which dashboard for which gateway](#which-dashboard-for-which-gateway) is the only statement there is.

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
| `-gateway-supported-min` | `GATEWAY_SUPPORTED_MIN` | | Oldest gateway release this build supports (`x.y.z`). Set together with `GATEWAY_SUPPORTED_MAX`; when either is unset or unparsable the dashboard shows no compatibility notice |
| `-gateway-supported-max` | `GATEWAY_SUPPORTED_MAX` | | Newest gateway release this build was tested against (`x.y.z`). `make dev` sets both from `deploy/ci/gateway-pins.json` when `jq` is installed; the BFF only informs and never refuses a gateway |
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
make compat                              # against gateway:latest
OPENSHELL_VERSION=0.1.0 make compat      # against a specific gateway release

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
being read as a plain string. Always run `make compat` after an SDK bump.

The gateway's **TOML config is versioned too**, and the schemas are mutually
exclusive — `0.1.0` and newer require v2, releases up to `0.0.116` require v1:

| | v1 (≤ 0.0.116) | v2 (≥ 0.1.0) |
|---|---|---|
| `version` | `1` | `2` |
| compute driver | `compute_drivers = ["docker"]` | `compute_driver = "docker"` |
| `image_pull_policy` | `"IfNotPresent"` | `"if_not_present"` |
| `sandbox_namespace` | supported | removed |

`OPENSHELL_CONFIG_SCHEMA` (`v1`\|`v2`, default `v2`) picks the template in
`deploy/ci/gateway.e2e.*.toml.tmpl`.

Two tag gotchas:

- **`latest` is not upstream HEAD.** It is the newest *release*. **`dev`** tracks
  upstream HEAD and is the only tag that keeps pace with `sdk/go@latest`.
- Gateway and supervisor share a tag and must match.

### Two jobs, two questions

Per [ADR 0005](docs/adrs/0005-gateway-version-compatibility.md), as amended by
[ADR 0006](docs/adrs/0006-compat-links-and-sweep-axes.md), the dashboard pins a
supported **range** and never claims `latest`:

| Job | When | Blocking | Question |
|---|---|---|---|
| `compat` (ci.yml) | per PR | yes | do we still honor the range we promised? |
| `compat-sweep` | weekly / manual | no | how far ahead can we move? |

`compat` runs the **required lanes** in `deploy/ci/gateway-pins.json`: the
oldest gateway release the dashboard still works with and the newest it has
been tested against. Those two are the ends of the [supported
range](#compatibility), and proving them is what a PR needs to do. Looking
around at other releases is the sweep's job, on a schedule, not something every
PR pays for.

Lanes are releases, pinned by digest. A `dev` gateway cannot be pinned that
way: it pulls `ghcr.io/nvidia/openshell/sandbox:dev`, a moving tag, at runtime,
which is how a digest-pinned `dev` lane turned `main` red on 2026-10-02 with no
change on our side. A required lane must therefore be a release, and
`scripts/gateway-range.mjs` refuses to derive a range from anything else.

### Three links, each proven separately

The chain is gateway → SDK → BFF → UI, and no link is inferred from another:

| Link | Proven by |
|---|---|
| **wire:** gateway ↔ SDK | `backend/test/compat` against a real gateway, with `-count=1` |
| **source:** SDK ↔ BFF | the compiler, `go vet` and the unit tests |
| BFF ↔ UI | shipping both from one commit |

The newest gateway is not assumed to work with the newest SDK, in either
direction. A result always names the link it is about: a compile error is a
source migration, and is never reported as a gateway problem.

### The sweep has two axes

`compat-sweep` asks two questions, and each holds the other side still:

| Axis | Held still | Varies | Question | Its pull request changes |
|---|---|---|---|---|
| gateway | the SDK pin in `backend/go.mod` | the gateway image | which gateways does the code we ship today work with? | `deploy/ci/gateway-pins.json` only: the ceiling lane moves |
| SDK | the required lanes | the SDK | can we move to a newer SDK without losing a gateway we support? | `backend/go.mod`, `backend/go.sum` and the `sdk` field of the pins file |

Each pull request also regenerates the [table under Compatibility](#what-this-branch-supports),
because each moves a value that table restates.

**Gateway axis.** The BFF is built once, from the checked-in `go.mod`, and run
against upstream releases from the floor up. A release above the ceiling that
passes moves the ceiling lane to it; the floor lane stays, and the ceiling
never moves past a release that failed. A release that fails is a *wire*
incompatibility between the SDK we pin and that gateway. The axis can also be
asked to look below the floor; that answer is informational and never a pull
request.

**SDK axis.** There is one possible target: the SDK at the commit of the newest
upstream release tag, when that is newer than the pin. It is built, vetted and
unit-tested first. If that fails, the result is a *source* migration (the BFF
does not compile against that SDK) and no gateway is consulted. If it passes,
the compat suite runs against every required lane. Passing all of them opens
the pull request. Failing the floor is reported as "this SDK would drop gateway
*floor*" and a person decides; the floor is never raised automatically.

Both axes also probe **upstream HEAD** (the `dev` gateway, `sdk@latest`) as
early warning: once the pins sit on releases, nothing else watches HEAD.
Neither is ever pinned, and neither ever opens a pull request.

So the SDK and the gateway lanes do **not** move together. One thing ties the
two files to each other: the `sdk` field of `deploy/ci/gateway-pins.json` must
equal the SDK version in `backend/go.mod`, and CI fails when it does not
(`node scripts/gateway-range.mjs --check`). When both pull requests are open,
each was proven against `main` as it stood, not against the other: merge one,
update the other so the required lanes run on the combination, then merge the
second.

What a sweep finds goes to one place each:

- **At most one pull request per axis**, rewritten in place by later sweeps and
  never merged automatically. A pull request opened with the workflow's default
  token does not start CI by itself; its description says how to start it.
- **One issue**, labelled `compat-migrate`, rewritten in place and closed
  automatically once nothing is outstanding. Every row says which link failed
  (wire or source) and what to do about it.

A failure is the most valuable result, so it is never silent. A sweep leg that
does not report is neither a pass nor a failure: it leaves the issue and that
axis's pull request untouched and turns the run red.

A sweep crosses the v1/v2 config boundary, so its gateway legs run with
`OPENSHELL_CONFIG_SCHEMA=auto`, which tries v2 and falls back to v1 when the
gateway rejects the config.

The pins live in `deploy/ci/gateway-pins.json`, read by the `compat` matrix in
`ci.yml` and edited structurally by the sweep's pull requests, which is why
they are not inlined in the workflow. The sweep's decisions are plain code with
tests, in [`deploy/ci/sweep/`](deploy/ci/sweep/).

`OPENSHELL_VERSION` selects the gateway *and* supervisor tag — they are
released together and must match. The community sandbox image publishes no
semver tags, so it is pinned separately via `COMPAT_SANDBOX_IMAGE` and
deliberately does not move with the gateway.

> Local runs need a Docker-compatible socket at `/var/run/docker.sock`. Rootless
> Podman on macOS does not satisfy the gateway's Docker driver out of the box —
> override with `DOCKER_SOCK` and `OPENSHELL_STATE_DIR` if your setup differs.

## Container image

CI publishes `quay.io/gkrumbach07/openshell-dashboard` (linux/amd64 and linux/arm64). The image is built once per commit; every other tag is that same image, retagged by digest:

| Tag | Points at | Moves when |
|---|---|---|
| `X.Y.Z` | the image built for the commit released as `vX.Y.Z` | never: it is written once, and the retag refuses to point it anywhere else |
| `X.Y` | the newest `X.Y.z` release | a patch release is cut |
| `latest` | the newest commit on `main` that passed **every** CI job, including the required compat lanes, while it was the tip of `main` | CI goes green on the tip of `main`; it only moves forward, so re-running an older run does not pull it back |
| `sha-<7>` | the image built for that commit, whether or not its checks passed | only when CI is re-run in full for that commit, which builds it again |
| `pr-<n>` | the latest build of that pull request | the PR is updated |

Version tags are created automatically starting with the first release cut after `1.1.1`. `1.1.1` itself was tagged once by hand (`1.1.1` is the same image as `sha-9fbdc37`, and like every release before the automation it declares no gateway range). Releases before it have no `X.Y.Z` or `X.Y` tag and never get one automatically. What exists for them is the commit tag, `sha-` plus the first seven characters of the released commit. The ones you are likely to need:

| Release | Image tag |
|---|---|
| `1.1.1` | `1.1.1` (also `sha-9fbdc37`) |
| `1.1.0` | `sha-71335e5` |
| `0.3.0` | `sha-978bcb5` ([do not use](#which-dashboard-for-which-gateway)) |
| `0.2.0` | `sha-701454a` |

For a deployment, pin `X.Y.Z` (or the commit tag, for a release in the table above) and check it against your gateway in [Compatibility](#compatibility). How releases are cut is in [docs/releasing.md](docs/releasing.md).

To build it yourself:

```bash
make build
podman run -p 8080:8080 \
  -e OPENSHELL_GATEWAY_URL=host.containers.internal:50051 \
  -e AUTH_DISABLED=true \
  openshell-dashboard:latest
```

A plain build like this does not pass the range build args, so `GATEWAY_SUPPORTED_MIN`, `GATEWAY_SUPPORTED_MAX` and the labels are empty: the image makes no claim. CI fills them in from `node scripts/gateway-range.mjs`.

For local OIDC testing without containers, use `./scripts/dev-env.sh start` instead (see above).

## Architecture

```
Browser ── REST ──► Go BFF ── gRPC (bearer) ──► OpenShell gateway
           (React Query)     (OpenShell Go SDK)
```

- **The vendored Go SDK is the source of truth.** Handlers call `github.com/NVIDIA/OpenShell/sdk/go` directly. The only remaining low-level escape hatch is `backend/pkg/clients/rawexec.go` for binary-safe file uploads, because the public SDK still lacks a non-TTY exec API that accepts raw stdin bytes.
- **Polling for status**: sandbox state uses polling (5s via React Query `refetchInterval`). WebSockets are used only for the interactive terminal.
- **Secrets never reach the browser**: provider credentials are write-only; the BFF serializes only credential key names.
- **Sandbox stop/start** (OpenShell v0.0.113+): the lifecycle is create → ready/error → (stop ⇄ start) → delete. Stopping retains persistent state; there is still no suspend/restart. The UI reflects the API as-is.
- Sandbox **policy is required at create**: the form ships client-side starter templates (the gateway has no server-side policy library).

See `CLAUDE.md` and `.claude/rules/` for contributor conventions.
