---
description: Security conventions for the OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- Authentication is proxy-delegated (see ADR 0003): BFF reads the bearer token from a configurable header (default `x-forwarded-access-token`) or `Authorization: Bearer` and forwards it to the gateway
- The BFF does NOT validate JWTs — it is a dumb pipe for tokens. The gateway validates against its own OIDC JWKS
- In standalone OIDC mode, the frontend stores tokens in JavaScript memory (`authStore.ts`) and sends as `Authorization: Bearer` — not in cookies or localStorage
- Never expose raw gRPC errors to the frontend — use `writeGrpcError()` which maps gRPC status codes to safe HTTP status codes
- CORS configured explicitly — no wildcard origins, empty allowlist by default

## Secrets

- API keys, tokens, and credentials are NEVER returned to the frontend
- Provider credentials are write-only from the dashboard perspective
- The gateway marks secret fields with `[(openshell.options.v1.secret) = true]` — the BFF's `models.From*()` functions must strip these before returning to the browser
- The `models.FromProvider()` function returns only credential key names, never values

## Input validation

- Validate all user input at the BFF layer before forwarding to gRPC
- Sandbox names: DNS-1123 label format (`validDNS1123()` in `respond.go`)
- Workspace names: DNS-1123 label format
- Policy YAML: validate structure via `models.ParsePolicy()` before sending to gateway
- Request bodies: use `decodeBody()` which enforces `MaxBytesReader` and `DisallowUnknownFields`

## No inline credentials

- Gateway URL, OIDC issuer, auth header names — all from env vars or flags, never hardcoded
- No `.env` files committed
