# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell). Go BFF + React frontend. Talks to the OpenShell gateway via gRPC.

## Project structure

```
frontend/           React + TypeScript + PatternFly 6
  src/app/          App shell, routing (App.tsx), layout, theme
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

- **Downstream consumption** ([ADR 0001](docs/adrs/0001-downstream-consumption.md)). Consumers install the npm package and get exactly five mechanisms: barrels, slots, self-contained pages with navigation callbacks, feature flags, runtime config (`setApiBasePath`). Minimal co-located CSS (layout rules only, all values via PF tokens). Zero imports from any downstream platform.
- **Relay-only auth** ([ADR 0002](docs/adrs/0002-auth-relay-only-bff.md)). The BFF never terminates authentication — a fronting proxy (oauth2-proxy standalone, the host platform's proxy when embedded) owns login/sessions/refresh/CSRF and injects `x-forwarded-access-token`. Bearer chain: proxy header → `Authorization: Bearer` → 401. The BFF never validates tokens and never authorizes. The only auth switch is `AUTH_DISABLED` (dev).
- **Surface the API as-is.** The upstream OpenShell API defines what exists — never invent RPCs, fields, lifecycle states, or abstractions (no Agent object; Sandbox is fundamental, labels categorize). See `.claude/rules/openshell-api.md` for the hard rules.
- **PatternFly 6 only.** No MUI, no custom design system, no inline styles with hardcoded values.
- **gRPC via protoc-generated stubs.** The `internal/gateway/` package wraps ~30 user-facing RPCs. Skip internal/supervisor RPCs.

## OpenShell API reference

The gateway exposes RPCs across 2 services (`OpenShell`, `Inference`), consumed via the vendored `github.com/NVIDIA/OpenShell/sdk/go` (see `.claude/rules/openshell-api.md`) — not a local proto copy.

## Personas

- **Platform Admin** — cross-workspace: gateway info, workspace CRUD, platform providers
- **Workspace Admin** — per-workspace: members, providers, policies, inference
- **User** — per-workspace: sandbox CRUD, logs, connect

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, commit conventions (Conventional Commits + DCO sign-off), code standards, and the AI contribution policy.
