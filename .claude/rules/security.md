---
description: Security conventions for the OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- The BFF is relay-only (ADR 0014): it NEVER terminates authentication. A fronting auth proxy (oauth2-proxy standalone, kube-auth-proxy federated) owns login, sessions, refresh, logout, and CSRF, and injects the bearer
- Bearer resolution is one precedence chain — `x-forwarded-access-token` → `Authorization: Bearer` → 401. No cookies, no session codec, no OIDC endpoints in the BFF
- The BFF NEVER validates tokens (no JWKS, no go-oidc, no JWT parsing) and NEVER authorizes (ADR 0003, ADR 0011). The gateway validates against its own OIDC JWKS and enforces RBAC
- Deployment invariant: trusting `x-forwarded-access-token` is safe only when the proxy is the sole network path to the BFF (localhost sidecar, pod-internal port, proxy-only ingress). Manifests must enforce this; never expose the BFF port directly in an authenticated deployment
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
