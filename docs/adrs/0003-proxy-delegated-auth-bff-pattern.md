# ADR 0003: Proxy-Delegated Auth as the BFF Pattern

**Status:** Accepted  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

The BFF sits between the frontend and the OpenShell gateway. It needs to handle authentication in both standalone and federated deployments. We evaluated:

1. **BFF validates JWTs itself** (go-oidc, JWKS validation) — the original approach from early prototypes
2. **BFF delegates auth to an external proxy** — matches odh-dashboard's kube-rbac-proxy/kube-auth-proxy pattern
3. **BFF mints its own tokens** — service mesh pattern, adds signing key management

## Decision

Proxy-delegated auth. The BFF is a **dumb pipe for tokens** — it reads them from headers and forwards them. It never validates, parses, or cares what kind of token it receives (opaque, JWT, SA token).

Implementation: `proxy.go` middleware reads from `x-forwarded-access-token` header (proxy mode) or `Authorization: Bearer` header (standalone mode), stores in context. `client.go` gateway client reads from context and forwards as gRPC `authorization: Bearer` metadata.

The BFF has zero OIDC validation dependencies (no `go-oidc`, no JWKS fetching, no token introspection). The OIDC handler endpoints (`/auth/discovery`, `/auth/token-exchange`, `/auth/refresh`) are server-side proxies for the frontend's PKCE flow — they pass through to the IDP without inspecting or validating the tokens themselves.

## Why this over BFF-side JWT validation

- **Matches odh-dashboard convention.** Every BFF in the modular architecture (model-registry, gen-ai, agent-ops, maas) uses proxy-delegated auth. Adding BFF-side validation would be a divergence.
- **Provider-agnostic.** The BFF works identically regardless of whether the token is from Dex, Keycloak, Entra ID, or an OpenShift ServiceAccount. No provider SDK imports, no issuer-specific configuration for validation.
- **Separation of concerns.** Auth validation is the proxy's job in production and the IDP's job in standalone. The BFF focuses on its actual job: translating REST to gRPC.

## Consequences

- The BFF trusts whatever token it receives. In federated mode, the proxy is the trust boundary. In standalone mode, the IDP is the trust boundary.
- The gateway performs its own JWT validation — the BFF's role is forwarding, not gatekeeping.
- If a deployment has no proxy and no OIDC configured, the BFF accepts unauthenticated requests when `AUTH_DISABLED=true` (dev mode only).
