---
description: Security conventions for the OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- OIDC tokens stored in HTTP-only secure cookies, never in localStorage
- BFF validates JWT on every request before forwarding to gateway
- Never expose raw gRPC errors to the frontend — map to safe HTTP status codes
- CORS configured explicitly — no wildcard origins in production

## Secrets

- API keys, tokens, and credentials are NEVER returned to the frontend
- Provider credentials are write-only from the dashboard perspective
- The gateway marks secret fields with `[(openshell.options.v1.secret) = true]` — the BFF must strip these before returning to the browser

## Input validation

- Validate all user input at the BFF layer before forwarding to gRPC
- Sandbox names: DNS-1123 label format
- Workspace names: DNS-1123 label format
- Policy YAML: validate structure before sending to gateway

## No inline credentials

- Gateway URL, OIDC issuer, client ID — all from env vars or flags, never hardcoded
- No `.env` files committed
