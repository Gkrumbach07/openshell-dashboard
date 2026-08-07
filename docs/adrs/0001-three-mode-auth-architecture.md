# ADR 0001: Auth Modes and Auth Patterns

**Status:** Accepted (v3 — relay-only per ADR 0014; v2 of 2026-08-07 described the now-removed session-custodian pattern)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

Earlier versions of this ADR conflated two questions — *where is the
dashboard deployed* (a mode) and *how does a bearer reach the gateway* (a
pattern) — and then multiplied patterns: v2 had the BFF relaying headers in
federated mode while running a full session custodian (PKCE + encrypted
cookies + refresh) in standalone mode. ADR 0014 removed the custodian:
auth termination belongs to a fronting proxy in every authenticated
deployment.

With that, the pattern space collapses to something a reviewer can hold in
one hand.

## Decision

**One authenticated pattern: token relay.** The BFF reads a bearer, forwards
it to the gateway per-RPC, and forgets it. Modes differ only in who operates
the fronting proxy.

### Modes

| Mode | Activation | Who terminates auth | Bearer source |
|------|-----------|--------------------|---------------|
| **Dev** | `AUTH_DISABLED=true` | nobody — synthetic `dev-user`, no token ever forwarded | none |
| **Standalone** | default | **oauth2-proxy** shipped alongside the BFF (compose `auth` profile / k8s sidecar), configured against the deployment's IdP | `x-forwarded-access-token` |
| **Federated** | default | the platform's proxy (kube-auth-proxy in RHOAI) | `x-forwarded-access-token` |

Standalone and federated are the **same architecture** — the BFF cannot and
need not distinguish them. The old `OIDC_ISSUER` mode discriminator,
`TrustProxyHeader` gating, and the FE/BE mode-detection mismatch it caused
are all gone. The only switch left is `AUTH_DISABLED`.

Bearer resolution (`backend/internal/auth/proxy.go`):
`x-forwarded-access-token` → `Authorization: Bearer` (API clients) → 401.

### The deployment invariant

Unconditional trust in `x-forwarded-access-token` is safe only when the
proxy is the sole network path to the BFF (localhost sidecar, pod-internal
port, proxy-only ingress). This is the standard contract every
`x-forwarded-*` consumer lives under; manifests and the README state it
(ADR 0014).

### Frontend

The frontend reads `GET /api/v1/auth/config` and branches once:
`authDisabled` → dev login page ("Continue as developer"); otherwise render
the authenticated app — the proxy already guaranteed a logged-in user before
the first byte of HTML arrived. On a 401 (expired proxy session), the client
does a full page reload so the proxy re-authenticates, unless the host
installed `setSessionExpiredHandler`. There is no PKCE flow, no callback
page, no OIDC login UI.

### Future pattern: token exchange

If the platform later provides RFC 8693 token exchange (RHAISTRAT-2183 —
swap an incoming platform token for a gateway-scoped one), it slots in as a
second pattern behind the same bearer-resolution seam, or — better — lands
in the proxy layer where auth already lives. Nothing in the BFF pre-builds
for it. See ADR 0005.

## Consequences

- The BFF's auth surface is ~50 lines of header reading. No `go-oidc`, no
  session codec, no CSRF, no CORS allowlist, no `SESSION_SECRET`, no
  `OIDC_*` env.
- Any standard OIDC IdP works — via the proxy's configuration, not ours.
- The gateway's other auth modes (mTLS, Edge JWT, plaintext) remain out of
  scope for the dashboard; the proxy-to-user leg is OIDC, the BFF-to-gateway
  leg is the forwarded JWT.
- WebSocket upgrades authenticate like every other request: the proxy
  validates the upgrade and injects the header (ADR 0008).
