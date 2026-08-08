# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell). Go BFF + React frontend. Talks to the OpenShell gateway via gRPC.

## Project structure

```
frontend/           React + TypeScript + PatternFly 6
  src/app/          App shell, routing (App.tsx), layout; oidc/ subdir for auth
  src/pages/        Page components — flat files, exported for downstream
  src/components/   Shared components
  src/api/          REST client (client.ts), hooks, queryKeys.ts
  src/hooks/        Custom hooks (useBulkDelete, useListPage, useTableSelection)
  src/slots/        SlotProvider context for downstream UI injection
  src/types/        TypeScript interfaces
  src/utils/        Formatters and helpers
backend/            Go BFF
  cmd/              Entry point
  internal/api/     REST handlers (respond.go helpers, *_handler.go)
  internal/auth/    Proxy-delegated token extraction (proxy.go)
  internal/gateway/ gRPC wrapper + Interface (for test mocking)
  internal/models/  Response DTOs (From*() converters) and request builders
  proto/            Copied from NVIDIA/OpenShell/proto/
  gen/              protoc-generated Go stubs (datamodelv1, openshellv1, optionsv1, sandboxv1, inferencev1)
scripts/            Dev environment (dev-env.sh — Keycloak + gateway setup)
docs/adrs/          Architecture Decision Records
```

## Build and run

```bash
make setup          # install frontend + go deps
make proto          # regenerate Go stubs from proto files
make dev            # start frontend dev server + BFF with hot reload
make dev-full       # start Keycloak + gateway + dashboard (full OIDC stack)
make build          # produce container image
make test           # frontend unit tests + go tests
make lint           # eslint + golangci-lint
make typecheck      # tsc --noEmit
```

Requires a running OpenShell gateway: `openshell gateway start` (Podman) or point `OPENSHELL_GATEWAY_URL` at an existing one.

## Architecture rules

Each rule has a corresponding Architecture Decision Record in [`docs/adrs/`](docs/adrs/). Read those for full context, alternatives considered, and consequences.

- **Standalone upstream repo** ([ADR 0001](docs/adrs/0001-standalone-upstream-repo.md)). This is a community project, not an RHOAI feature. Zero `@odh-dashboard/*` imports. Downstream consumption via npm package ([ADR 0002](docs/adrs/0002-npm-package-consumption-model.md)).
- **Relay-only auth** ([ADR 0003](docs/adrs/0003-auth-relay-only-bff.md)). The BFF never terminates authentication — a fronting proxy (oauth2-proxy standalone, kube-auth-proxy federated) owns login/sessions/refresh/CSRF and injects `x-forwarded-access-token`. Bearer chain: proxy header → `Authorization: Bearer` → 401. The BFF never validates tokens and never authorizes. The only auth switch is `AUTH_DISABLED` (dev).
- **BFF scope boundary** ([ADR 0004](docs/adrs/0004-bff-scope-boundary.md)). The BFF has three jobs: API translation, browser-app hosting, operational surface. The never-list (no auth termination, no JWT validation, no RBAC, no k8s API, no credential brokering, no server-side state) is authoritative — cite it to reject scope creep.
- **Extension surface** ([ADR 0005](docs/adrs/0005-extension-surface.md)). Downstream consumers get exactly five mechanisms: npm barrels, slots, self-contained pages with navigation callbacks, feature flags, runtime config (`setApiBasePath`). Zero co-located CSS — PatternFly tokens only.
- **Proto is source of truth** ([ADR 0006](docs/adrs/0006-proto-source-of-truth.md)). `backend/proto/` defines what exists. Never invent RPCs, fields, or lifecycle states. See `.claude/rules/openshell-api.md` for the full list of hard rules.
- **Sandbox is the fundamental object** ([ADR 0007](docs/adrs/0007-sandbox-centric-object-model.md)). No invented Agent abstraction. Surface the API as-is, bottom-up. Labels categorize workloads.
- **Polling for data, WebSocket for the terminal only** ([ADR 0008](docs/adrs/0008-polling-and-the-terminal.md)). All data uses React Query `refetchInterval`. The terminal is the single sanctioned WebSocket, gated by `FEATURE_TERMINAL` for deployments whose transport can't relay it.
- **PatternFly 6 only.** No MUI, no custom design system, no inline styles with hardcoded values.
- **gRPC via protoc-generated stubs.** The `internal/gateway/` package wraps ~30 user-facing RPCs. Skip internal/supervisor RPCs.

## OpenShell API reference

The gateway exposes 68 gRPC RPCs across 2 services (64 in `OpenShell`, 4 in `Inference`). Proto files are in `backend/proto/`.

## Personas

- **Platform Admin** — cross-workspace: gateway info, workspace CRUD, platform providers
- **Workspace Admin** — per-workspace: members, providers, policies, inference
- **User** — per-workspace: sandbox CRUD, logs, connect

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, commit conventions (Conventional Commits + DCO sign-off), code standards, and the AI contribution policy.
