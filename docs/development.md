# Development

How to run the dashboard from a checkout, test it, and find your way around the code. To install it on a cluster, see [install.md](install.md).

## Prerequisites

- Go 1.26.7 or newer (`backend/go.mod`), Node 22.
- A running OpenShell gateway of the supported release line ([installing OpenShell](https://github.com/NVIDIA/OpenShell/blob/main/docs/about/installation.mdx)): the line under [Compatibility](../README.md#compatibility).
- Docker and `jq`, for the compat suite; Docker also builds the image.
- For `make lint`, [golangci-lint](https://github.com/golangci/golangci-lint) v2 built with Go 1.26.7 or newer; an older build stops before it lints. CI runs v2.12.2.

## Run it locally

1. `make setup` installs the frontend and Go dependencies.
2. Export the gateway's address and certificates, as in [Connecting to a gateway outside the chart](configuration.md#connecting-to-a-gateway-outside-the-chart).
3. `make dev` starts two processes:

| Process | Address | Notes |
|---|---|---|
| Vite dev server | `http://localhost:3000` | Serves the UI with hot reload and proxies `/api` to the BFF |
| Go BFF | `http://localhost:8080` | Runs with `AUTH_DISABLED=true` unless you set it. Restart it after a Go change |

Open `http://localhost:3000` and choose **Continue as developer**. Sign-in is off, so the BFF forwards no token.

Without a gateway of your own, `make compat-up` starts the release this branch is built on in Docker ([the compat suite](#the-compat-suite)); then run `OPENSHELL_GATEWAY_URL=localhost:8080 PORT=9080 BFF_URL=http://localhost:9080 make dev`.

To run the dashboard with sign-in on a local cluster, see [`deploy/keycloak/dev/README.md`](../deploy/keycloak/dev/README.md).

## Make targets

| Target | What it does |
|---|---|
| `make setup` | `npm install` in `frontend/`, `go mod download` in `backend/` |
| `make dev` | The Vite dev server and the BFF, as above. Only the frontend reloads on a change |
| `make test` | `go test ./...` and Jest |
| `make lint` | ESLint, the Prettier check and golangci-lint |
| `make typecheck`, `make format` | `tsc --noEmit`; Prettier, writing the files |
| `make build` | The container image, with `docker build` |
| `make compat`, `compat-up`, `compat-down` | [The compat suite](#the-compat-suite) |
| `make helm-lint`, `helm-test`, `helm-docs` | [The Helm chart](#the-helm-chart) |

## Tests

- **Unit tests.** `make test` runs the Go tests in `backend/` and Jest in `frontend/`.
- **UI tests with stubbed API responses.** In `frontend/`, run `npm start` in one terminal, then `npm run e2e` (or `npm run e2e:open`) in another. [`frontend/cypress/README.md`](../frontend/cypress/README.md) has the details.
- **Release and CI tooling.** `node --test "scripts/**/*.test.mjs"` and `python3 -m unittest discover -s deploy/ci/upstream`.

## The compat suite

The compatibility suite, `compat` for short, is `backend/test/compat`: Go tests that drive the BFF's REST API against a real gateway. It has the build tag `compat`, so `go test ./...` does not run it.

```sh
make compat                            # against the gateway this branch pins
OPENSHELL_VERSION=0.1.2 make compat    # against another gateway release, by its tag
make compat-up                         # only the gateway; make compat-down removes it
```

`make compat` starts the gateway with Docker Compose, builds the BFF, runs the suite and removes the gateway. It expects the Docker socket at `/var/run/docker.sock` and keeps the gateway's state in `/var/lib/openshell`, with `sudo` when it cannot write there; `DOCKER_SOCK` and `OPENSHELL_STATE_DIR` point it elsewhere. Without `jq` it runs the gateway tagged `latest` instead.

A unit test with a stand-in for the SDK cannot see a gateway that reads a request differently, so the suite runs against the pinned gateway on every pull request ([How it is tested](compatibility.md#how-it-is-tested)).

## Building the image

```sh
make build
docker run --rm -p 8080:8080 \
  -e OPENSHELL_GATEWAY_URL=https://gateway.example.com:17670 \
  -e AUTH_DISABLED=true \
  openshell-dashboard:latest
```

A gateway with a private CA or a client certificate also needs the files mounted and the [TLS](configuration.md#tls) variables set. This build passes no build arguments, so the image's `gateway.line` and `sdk` labels are empty and **Help → About** shows no commit. The compatibility notice still works: the release line is compiled into the BFF.

## The Helm chart

- `make helm-lint` lints and renders the chart with its defaults and with each `ci/values-*.yaml` on its own.
- `make helm-test` runs the chart's unit tests. It needs the [helm-unittest](https://github.com/helm-unittest/helm-unittest) plugin.
- `make helm-docs` regenerates the chart's `README.md` from `README.md.gotmpl` and the `# --` comments in `values.yaml`, with helm-docs 1.14.2 run through mise (`mise.toml`). Do not edit the generated file: CI fails when it differs from what helm-docs writes.

## Layout

```
frontend/            React, TypeScript, PatternFly 6
  src/app/           shell: App.tsx, routes (AuthenticatedRoutes.tsx, AppRoutes.tsx), layout, session
  src/pages/         one file per page
  src/components/    shared components
  src/api/           REST client (client.ts), React Query hooks, queryKeys.ts
  src/hooks/         shared UI hooks
  src/i18n/          UI text: useI18n and the English catalogs
  src/types/         TypeScript types of the API
  src/utils/         formatters and helpers
  cypress/           UI tests with stubbed API responses
backend/             Go BFF
  cmd/server/        entry point: flags, gateway clients, HTTP server
  pkg/server/        wiring and routes (app.go)
  pkg/handlers/      REST handlers, one struct per resource
  pkg/services/      the interfaces the handlers depend on
  pkg/models/        response types, converters and request builders
  pkg/clients/       per-request token forwarding and the three direct gRPC calls
  pkg/auth/          takes the bearer from the request
  pkg/apiutils/      shared HTTP helpers
  test/compat/       the compat suite
deploy/              Dockerfile, Helm chart (helm/), Keycloak realm (keycloak/), compat stack and gateway pins (ci/)
scripts/             release and CI tooling, dev-env.sh
images/              a sandbox image (claude-code/)
tasks/, mise.toml    the helm-docs task `make helm-docs` runs
.github/workflows/   CI (ci.yml), releases (publish.yml), Follow upstream (follow-upstream.yml)
docs/                these documents and the ADRs (adrs/)
```

The conventions for each part are in `.claude/rules/`: [`react.md`](../.claude/rules/react.md), [`bff-go.md`](../.claude/rules/bff-go.md), [`openshell-api.md`](../.claude/rules/openshell-api.md) and [`security.md`](../.claude/rules/security.md). UI text is covered in [`frontend/src/i18n/README.md`](../frontend/src/i18n/README.md).

A [feature flag](configuration.md#feature-flags) reaches the UI in `GET /api/v1/auth/config`. `useFeatureFlags()` in `frontend/src/api/auth.ts` returns the flags, each as on until that answer has arrived. A navigation entry names its flag (`featureKey`, in `navEntries` in `frontend/src/app/AppLayout.tsx`); a tab or an action asks the hook:

```tsx
const features = useFeatureFlags();
{features.terminal && <Tab eventKey="terminal" title={<TabTitleText>Terminal</TabTitleText>} />}
```

## Branches and the pinned OpenShell release

A branch is built on one OpenShell release, which `deploy/ci/gateway-pins.json` names: `main` on a stable release, `next` on the upcoming one. Which branch a change goes to is in [CONTRIBUTING.md](../CONTRIBUTING.md#where-a-pull-request-goes), and how the pinned release moves is in [`deploy/ci/upstream/README.md`](../deploy/ci/upstream/README.md).

## Known issues

`make dev-full` (`scripts/dev-env.sh start`, then `make dev`) starts Keycloak in Podman and builds a gateway from an OpenShell checkout, but writes a version 1 gateway config, which gateways from 0.1.0 on refuse: it does not start a gateway of the supported release line. `scripts/dev-env.sh stop` stops what it started.
