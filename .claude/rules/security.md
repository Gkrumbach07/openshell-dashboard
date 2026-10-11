---
description: Security conventions for OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- The BFF is relay-only (ADR 0002): it NEVER terminates authentication. The auth proxy (oauth2-proxy, which the Helm chart runs as a sidecar) owns sign-in, sessions, refresh, sign-out and CSRF, and sets the bearer
- Bearer resolution is one precedence chain — `x-forwarded-access-token` → `Authorization: Bearer` → 401. No cookies, no session codec, no OIDC endpoints in the BFF
- The BFF NEVER validates tokens (no JWKS, no go-oidc, no JWT parsing) and NEVER authorizes (ADR 0002). The gateway validates against its own OIDC JWKS and enforces RBAC
- Deployment invariant: trusting `x-forwarded-access-token` is safe only when the proxy is the sole network path to the BFF (ADR 0002, decision 5). The Helm chart enforces it: the BFF listens on `127.0.0.1`, the Service exposes the proxy's port only, and the NetworkPolicy admits that port only. Never expose the BFF port directly in a deployment
- Never expose raw gateway errors to the frontend — use `apiutils.WriteSDKError()` which maps SDK and fallback gRPC status codes to safe HTTP status codes
- The BFF has no CORS middleware — it is accessed same-origin (behind the auth proxy, or through the Vite dev server's proxy in local development), and the terminal's WebSocket refuses a handshake from another origin

## Secrets

- API keys, tokens, and credentials are NEVER returned to the frontend
- Provider credentials are write-only from the dashboard perspective
- The gateway marks secret fields with `[(openshell.options.v1.secret) = true]` — the BFF's `models.FromSDK*()` functions must strip these before returning to the browser
- `models.FromSDKProvider()` returns only credential key names, never values
- The gateway answers every provider read with each credential's value replaced by the literal `REDACTED`. That placeholder is not passed on either: `pkg/clients/rawprovider.go` returns the keys and nothing else. An update is never built from a provider that was read first, so the placeholder cannot travel back to the gateway as a credential's value

## Input validation

- Validate all user input at the BFF layer before forwarding to the gateway
- Sandbox names: DNS-1123 label format (`apiutils.ValidDNS1123()` in `pkg/apiutils/respond.go`)
- Workspace names: DNS-1123 label format
- Policy JSON: validate structure via `models.ParseSDKPolicy()` before sending to the gateway
- Request bodies: use `apiutils.DecodeBody()` which enforces `MaxBytesReader` and `DisallowUnknownFields`

## No inline credentials

- Gateway URL, TLS files, auth header names — all from flags or environment variables, never hardcoded
- No `.env` files committed
