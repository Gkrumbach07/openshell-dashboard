# ADR 0001: Three-Mode Authentication Architecture

**Status:** Accepted  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

The OpenShell Dashboard must run in three deployment contexts with fundamentally different auth requirements:

1. **Standalone** — community deployment, no auth proxy, frontend handles login
2. **Federated (RHOAI)** — runs inside odh-dashboard behind kube-auth-proxy, auth is handled before requests reach the BFF
3. **Dev** — local development, no auth needed

The OpenShell gateway enforces its own RBAC (workspace admin/user roles) using OIDC JWTs. This is different from other odh-dashboard BFFs (model-registry, gen-ai) whose downstream is k8s, which validates any token natively.

We evaluated several approaches:
- **Keycloak as shared IDP** — works but adds infrastructure RHOAI doesn't require
- **Gateway TokenReview support** — ideal but requires upstream NVIDIA change
- **BFF-side RBAC via SubjectAccessReview** — loses gateway's internal role model
- **Proxy-delegated auth with OIDC fallback** — matches odh patterns, adds standalone OIDC

## Decision

The BFF supports all three modes through a single auth middleware with no mode flag:

| Mode | How it activates | Frontend does | BFF does |
|------|-----------------|---------------|----------|
| Dev | `AUTH_DISABLED=true` env var | Shows "Continue as developer" | Skips token validation, injects `dev-user` |
| Standalone OIDC | `OIDC_ISSUER` + `OIDC_CLIENT_ID` set, no proxy | PKCE login → stores JWT → sends `Authorization: Bearer` | Proxies OIDC discovery, exchanges auth code, forwards JWT to gateway |
| Federated | Neither set, proxy injects headers | Nothing — renders directly | Reads `x-forwarded-access-token` or `Authorization: Bearer`, forwards to gateway |

The auth middleware (`proxy.go`) reads tokens from both `x-forwarded-access-token` (proxy mode) and `Authorization: Bearer` (standalone mode). It does not validate JWTs — it trusts the proxy in federated mode and trusts the IDP's token in standalone mode. The gateway validates the token against its own OIDC JWKS.

The frontend determines mode from the `/api/v1/auth/config` response:
- `authDisabled: true` → dev mode
- `issuer` + `clientId` present → standalone OIDC mode
- Neither → proxy-delegated mode (render authenticated app directly)

## Consequences

- **No provider-specific code.** The OIDC handler works with Dex, Keycloak, Okta, Entra ID, or any standard OIDC provider. The BFF never imports a provider SDK.
- **Federated mode matches odh-dashboard patterns exactly.** Same `x-forwarded-access-token` header, same proxy-delegated trust model as model-registry, gen-ai, agent-ops.
- **Standalone OIDC is additional scope** that model-registry doesn't need (because their downstream is k8s, not an OIDC-only gateway). This is necessary, not a hack.
- **The credential bridge gap remains for federated mode** when the cluster uses default OpenShift OAuth (opaque tokens). The gateway can't validate opaque tokens. This works when the customer configures an external OIDC provider (Keycloak/Entra), which kube-auth-proxy supports since RHOAI 3. For clusters without external OIDC, either the gateway needs TokenReview support or the BFF must enforce RBAC via SubjectAccessReview.
- **OIDC discovery is proxied server-side** (`/api/v1/auth/discovery`) to avoid CORS issues. This is a standard BFF pattern (Grafana, ArgoCD, Backstage all do this).
