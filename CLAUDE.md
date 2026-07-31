# OpenShell Dashboard

Standalone web admin UI for [OpenShell](https://github.com/NVIDIA/OpenShell). Go BFF + React frontend. Talks to the OpenShell gateway via gRPC.

## Project structure

```
frontend/           React + TypeScript + PatternFly 6
  src/app/          App shell, routing, OIDC login
  src/pages/        Page components (exported for downstream consumers)
  src/components/   Shared components
  src/api/          REST client hooks (React Query)
  src/types/        TypeScript interfaces
backend/            Go BFF
  cmd/              Entry point
  internal/api/     REST handlers
  internal/auth/    OIDC middleware
  internal/sdkclient/ SDK auth provider (per-request JWT forwarding)
  internal/models/  Response DTOs and SDK type converters
```

## Build and run

```bash
make setup          # install frontend + go deps
make dev            # start frontend dev server + BFF with hot reload
make build          # produce container image
make test           # frontend unit tests + go tests
make lint           # eslint + golangci-lint
make typecheck      # tsc --noEmit
```

Requires a running OpenShell gateway: `openshell gateway start` (Podman) or point `OPENSHELL_GATEWAY_URL` at an existing one.

## Architecture rules

- **SDK is source of truth.** `openshell-sdk-go` defines what exists. Before implementing anything API-adjacent, check the SDK interfaces. Never invent RPCs, fields, or lifecycle states (see `.claude/rules/openshell-api.md` for the list of things that famously don't exist: sandbox stop/start, workspace policy library, OCSF events API, member role update).
- **Zero `@odh-dashboard/*` imports.** This repo has no knowledge of odh-dashboard. Downstream consumption happens via a separate package that imports our components.
- **OIDC only for auth.** No mTLS, no OpenShift OAuth, no edge tokens.
- **gRPC via openshell-sdk-go.** The SDK client wraps ~30 user-facing RPCs with sub-clients (Sandboxes, Workspaces, Providers, Policy, Config, Inference, Services, Exec, Files). Skip internal/supervisor RPCs.
- **No WebSockets.** Downstream federation proxy can't handle them. Use polling for status, polling for logs.
- **PatternFly 6 only.** No MUI, no custom design system.
- **Page components must be self-contained and exportable.** Each page takes props and uses internal API hooks. No dashboard-specific wrappers baked in.

## OpenShell API reference

The gateway exposes 60+ gRPC RPCs across 4 services. We surface ~30 user-facing ones via the `openshell-sdk-go` Go SDK. See the full API surface map in the `brain/openshell-dashboard/api-surface.md` planning doc.

## Personas

- **Platform Admin** — cross-workspace: gateway info, workspace CRUD, platform providers
- **Workspace Admin** — per-workspace: members, providers, policies, inference
- **User** — per-workspace: sandbox CRUD, logs, connect
