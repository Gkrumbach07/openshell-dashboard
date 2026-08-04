---
description: Security conventions for the OpenShell Dashboard
globs: "backend/**,frontend/src/api/**"
alwaysApply: false
---

# Security

## Auth

- Authentication is delegated to an external auth proxy (oauth2-proxy, kube-rbac-proxy, etc.)
- The BFF reads the bearer token from a configurable header (default `x-forwarded-access-token`) and forwards it to the gateway
- The BFF does NOT perform OIDC validation — the auth proxy handles that
- Never expose raw gRPC errors to the frontend — map to safe HTTP status codes
- CORS configured explicitly — no wildcard origins, empty default

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

- Gateway URL, auth header names — all from env vars or flags, never hardcoded
- No `.env` files committed
