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

- **Standalone upstream repo** ([ADR 0006](docs/adrs/0006-standalone-upstream-repo.md)). This is a community project, not an RHOAI feature. Zero `@odh-dashboard/*` imports. Downstream consumption via npm package ([ADR 0002](docs/adrs/0002-npm-package-consumption-model.md)).
- **Proto is source of truth** ([ADR 0007](docs/adrs/0007-proto-source-of-truth.md)). `backend/proto/` defines what exists. Never invent RPCs, fields, or lifecycle states. See `.claude/rules/openshell-api.md` for the full list of hard rules.
- **Three-mode auth** ([ADR 0001](docs/adrs/0001-three-mode-auth-architecture.md)). Dev (`AUTH_DISABLED`), standalone OIDC (PKCE), and federated (proxy-delegated). BFF is a dumb pipe for tokens — never validates JWTs ([ADR 0003](docs/adrs/0003-proxy-delegated-auth-bff-pattern.md)). OIDC only, no mTLS, no OpenShift OAuth.
- **No WebSockets** ([ADR 0008](docs/adrs/0008-polling-not-streaming.md)). Downstream federation proxy can't handle them. All real-time data uses polling via React Query `refetchInterval`. Terminal access is via the CLI.
- **Sandbox is the fundamental object** ([ADR 0009](docs/adrs/0009-sandbox-centric-object-model.md)). No invented Agent abstraction. Surface the API as-is, bottom-up. Labels categorize workloads.
- **Self-contained exportable pages** ([ADR 0004](docs/adrs/0004-self-contained-page-components.md)). Each page takes props, uses internal API hooks, supports optional navigation callbacks with `useNavigate` fallback. Slot system for downstream UI injection.
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
