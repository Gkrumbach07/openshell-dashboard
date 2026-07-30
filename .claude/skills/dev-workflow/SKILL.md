---
name: dev-workflow
description: Full development workflow for OpenShell Dashboard. Implements the change, runs lint/typecheck/tests, verifies the result. Use when asked to implement a feature, fix a bug, or make any code change.
---

# Dev Workflow

## Before coding

1. Read the relevant planning docs if unsure about architecture:
   - `brain/openshell-dashboard/architecture.md` — repo structure, auth, real-time approach
   - `brain/openshell-dashboard/api-surface.md` — which RPCs to use, phased scope
   - `brain/openshell-dashboard/ux-views.md` — what each view should contain

2. Check if the change touches the BFF, frontend, or both.

## Implement

- Follow rules in `.claude/rules/` (react.md, bff-go.md, openshell-api.md, security.md)
- Page components must be self-contained and exportable (no dashboard-specific wrappers)
- BFF handlers call `internal/gateway/` wrapper methods, not raw gRPC directly

## Verify

Run in order, fix failures before proceeding:

```bash
# Frontend
cd frontend && npm run lint && npm run typecheck && npm run test

# Backend
cd backend && golangci-lint run ./... && go test ./...
```

## For UI changes

Start the dev server and verify in a browser:

```bash
make dev  # requires OPENSHELL_GATEWAY_URL
```

Check: does the page load? Does the data display? Do actions (create, delete) work? Are error states handled?
