---
description: Security conventions for the OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- Auth is modes × patterns (ADR 0001): bearer resolution is one precedence chain — `x-forwarded-access-token` (only when `TrustProxyHeader`, i.e. federated mode) → `Authorization: Bearer` → encrypted session cookie → 401
- The BFF takes custody of tokens but NEVER validates them (no JWKS, no go-oidc) and NEVER authorizes (ADR 0003, ADR 0011). The gateway validates against its own OIDC JWKS and enforces RBAC
- In standalone OIDC mode, tokens live in an AES-256-GCM encrypted `__Host-openshell-session` cookie (HttpOnly, Secure, SameSite=Strict) managed by the BFF (ADR 0010). The browser never sees a token; `authStore.ts` holds only a dev-mode flag. Refresh is server-side and transparent; `SESSION_SECRET` derives the key and is required in production
- The `x-forwarded-access-token` header is honored ONLY in federated mode — in standalone there is no sanitizing proxy, so honoring it would let any client forge it (`TrustProxyHeader` in `proxy.go`)
- CSRF: SameSite=Strict primary, Origin check on mutating methods as defense-in-depth. Requests without Origin pass (non-browser clients can't carry cookies)
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
