---
name: dev-workflow
description: Full development workflow for OpenShell Dashboard. Implements the change, runs lint/typecheck/tests, verifies the result. Use when asked to implement a feature, fix a bug, or make any code change.
---

# Dev Workflow

## Before coding

1. Read the relevant docs if unsure about architecture:
   - `CLAUDE.md` — project structure, architecture rules with ADR links
   - `docs/adrs/` — Architecture Decision Records
   - `backend/proto/` — source of truth for what RPCs exist (see `.claude/rules/openshell-api.md`)

2. Check if the change touches the BFF, frontend, or both.

## Implement

- Follow rules in `.claude/rules/` (react.md, bff-go.md, openshell-api.md, security.md)
- Page components must be self-contained and exportable (no dashboard-specific wrappers)
- BFF handlers call `internal/gateway/` wrapper methods, not raw gRPC directly

## Verify

Run in order, fix failures before proceeding:

```bash
make lint       # eslint + Prettier check + go vet
make typecheck  # tsc --noEmit
make test       # jest + go test
```

Or individually:

```bash
# Frontend
cd frontend && npm run lint && npm run format:check && npm run typecheck && npm test

# Backend
cd backend && go vet ./... && go test ./...
```

## For UI changes

Start the dev server and verify in a browser:

```bash
make dev  # requires OPENSHELL_GATEWAY_URL
```

Check: does the page load? Does the data display? Do actions (create, delete) work? Are error states handled?
