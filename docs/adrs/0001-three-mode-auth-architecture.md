# ADR 0001: Auth Modes and Auth Patterns

**Status:** Accepted (v2 — supersedes the 2026-08-05 version; incorporates ADR 0010)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The dashboard runs in three deployment contexts, and early versions of this ADR
described auth as three "modes." That framing conflated two different questions:

1. **Where is the dashboard deployed?** (a *mode* — an operator decision)
2. **How does a bearer token reach the gateway?** (a *pattern* — an architecture)

Conflating them produced drift: the standalone flow was rewritten from
sessionStorage tokens to encrypted session cookies (ADR 0010) without this ADR
noticing, and mode checks are scattered across eight call sites in two languages
with two different definitions of "standalone" (backend keys on `OIDC_ISSUER`;
frontend keys on `issuer && clientId` — set one without the other and the two
halves disagree; see issue backlog).

## Decision

Auth is described on two axes. **Modes** are deployment contexts. **Patterns**
are token-custody strategies. Each mode binds to exactly one pattern.

### The three modes

| Mode | Activation | Trust boundary |
|------|-----------|----------------|
| **Dev** | `AUTH_DISABLED=true` | none — synthetic `dev-user`, no token ever forwarded |
| **Standalone** | `OIDC_ISSUER` set (and not disabled) | the OIDC IdP |
| **Federated** | neither set | the fronting auth proxy (kube-auth-proxy, oauth2-proxy) |

### The three patterns

| Pattern | Custody | Who uses it |
|---------|---------|-------------|
| **Token relay** | none — read a header, forward it, forget it | Federated mode (`x-forwarded-access-token`), API clients (`Authorization: Bearer`) |
| **Session custodian** | full — BFF runs PKCE, seals tokens into an encrypted `__Host-` cookie, refreshes server-side (ADR 0010) | Standalone mode |
| **Token exchange** | delegated — swap an incoming token for a gateway-scoped token via RFC 8693 | *Not implemented.* The future federated pattern if/when the platform provides a shared IdP with token exchange (RHAISTRAT-2183); see ADR 0005 |

### Mode × pattern binding

| Mode | Pattern | `TrustProxyHeader` | Session codec |
|------|---------|--------------------|---------------|
| Dev | none | false | nil |
| Standalone | session custodian (+ Bearer relay for API clients) | **false** — honoring the proxy header here would let any client forge it | built |
| Federated | token relay | true | nil |

Bearer resolution is one precedence chain for all modes
(`backend/internal/auth/proxy.go`): proxy header (if trusted) → `Authorization:
Bearer` → session cookie → 401.

### Frontend mode detection

The frontend derives its mode solely from `GET /api/v1/auth/config`:
`authDisabled` → dev; `issuer` present → standalone (login page + PKCE);
neither → federated (render authenticated app directly). The config endpoint is
the single source of truth — the frontend must never infer mode from its own
environment.

## Consequences

- **One mode enum, computed once.** The scattered boolean checks
  (`main.go`, `oidc_handler.go` ×3, `App.tsx`, `logout.ts`, `LoginPage.tsx`)
  must collapse into a single `AuthMode` computed in `main.go` and echoed
  verbatim in `/auth/config`. Until then the FE/BE detection mismatch
  (`OIDC_ISSUER` set without `OIDC_CLIENT_ID` → backend standalone, frontend
  federated, no login UI reachable) is a live bug. Tracked as a proposed issue.
- **No provider-specific code.** Any standard OIDC IdP works (Keycloak, Dex,
  Okta, Entra ID). The BFF never imports a provider SDK.
- **Patterns are additive, not conditional.** A new pattern (token exchange)
  slots into the resolution chain without touching the existing two. Mode
  logic never leaks into handlers — handlers see "there is a bearer in the
  context" and nothing else.
- The gateway supports four auth modes upstream (mTLS, OIDC, Edge JWT,
  plaintext). The dashboard supports exactly two of them: **OIDC** and
  **unauthenticated** (dev). mTLS and Edge JWT client auth are explicitly out
  of scope for the BFF.
