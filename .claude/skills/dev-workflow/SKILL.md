---
name: dev-workflow
description: Full development workflow for OpenShell Dashboard. Implements the change, runs lint/typecheck/tests, verifies the result. Use when asked to implement a feature, fix a bug, or make any code change.
---

# Dev Workflow

## Before coding

1. Read the relevant docs if unsure about architecture:
   - `CLAUDE.md` — project structure, architecture rules with ADR links
   - `docs/adrs/` — Architecture Decision Records
   - `.claude/rules/openshell-api.md` — how to read the OpenShell Go SDK's surface, and the hard facts about the gateway's API

2. Check if the change touches the BFF, frontend, or both.

## Implement

- Follow rules in `.claude/rules/` (react.md, bff-go.md, openshell-api.md, security.md)
- Page components are self-contained: explicit props, data through the `src/api/` hooks
- BFF handlers reach the OpenShell Go SDK through an injected `pkg/services` interface (`h.svc`), never a raw client. The exceptions are three direct gRPC calls in `pkg/clients`, each for a named gap in the SDK: `rawexec.go` (binary-safe uploads), `rawprovider.go` with `rawprovider_allworkspaces.go` (the keys of a provider's credentials) and `rawprofile.go` (provider profiles)

## Verify

Run in order, fix failures before proceeding:

```bash
make lint       # eslint + Prettier check + golangci-lint (v2, built with Go 1.26.7 or newer)
make typecheck  # tsc --noEmit
make test       # jest + go test
```

Or individually:

```bash
# Frontend
(cd frontend && npm run lint && npm run format:check && npm run typecheck && npm test)

# Backend. The linter is run at the version CI uses, whatever is installed.
(cd backend && GOTOOLCHAIN=go1.26.7 go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run ./... && go test ./...)
```

## For UI changes

Start the dev server and verify in a browser:

```bash
make dev  # needs a running gateway; OPENSHELL_GATEWAY_URL points at it
```

Check: does the page load? Does the data display? Do actions (create, delete) work? Are error states handled?
