# ADR 0002: Auth — Relay-Only BFF Behind a Fronting Proxy

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The dashboard runs in three deployment contexts (local dev, standalone
community installs, embedded in a hosting platform), and the OpenShell gateway
enforces its own RBAC using OIDC JWTs validated against its JWKS. Someone has
to get a JWT from the user's browser to the gateway on every request.

## Decision

**The BFF never terminates authentication.** A fronting auth proxy owns
login, sessions, refresh, logout, and CSRF in every authenticated
deployment. The BFF relays bearers and does nothing else with them.

### Modes

| Mode | Activation | Who terminates auth | Bearer source |
|------|-----------|--------------------|---------------|
| **Dev** | `AUTH_DISABLED=true` | nobody — synthetic `dev-user`, no token forwarded | none |
| **Standalone** | default | **oauth2-proxy** shipped alongside the BFF, configured against the deployment's IdP | `x-forwarded-access-token` |
| **Federated** | default | the host platform's auth proxy | `x-forwarded-access-token` |

Standalone and federated are the **same architecture** with different proxy
operators — the BFF cannot and need not distinguish them. The only auth
switch is `AUTH_DISABLED`.

Bearer resolution: `x-forwarded-access-token` → `Authorization: Bearer` → 401.

### What the BFF never does with a token

1. **No termination.** No login flows, no OIDC endpoints, no cookies, no
   session state, no refresh, no logout logic.
2. **No validation.** No JWKS, no signature/issuer/audience checks, no JWT
   parsing. The gateway validates against its own JWKS; a second validator
   would drift.
3. **No authorization.** The gateway enforces RBAC. Frontend role display
   comes from `GetCurrentUser`; hiding a nav item is UX, not enforcement.
4. **No ambient identity.** Every gRPC call carries the caller's bearer via
   per-RPC credentials. No service-account fallback.

### The deployment invariant

Unconditional trust in `x-forwarded-access-token` is safe only when the
proxy is the **sole network path** to the BFF (localhost sidecar,
pod-internal port, proxy-only ingress). Never expose the BFF port directly
in an authenticated deployment.

### Frontend behavior

The frontend reads `GET /api/v1/auth/config` and branches once:
`authDisabled` → dev login page; otherwise render the authenticated app —
the proxy guaranteed a logged-in user before the first byte of HTML arrived.
On 401 (expired proxy session): full page reload so the proxy
re-authenticates, unless the host installed `setSessionExpiredHandler`.
No PKCE flow, no callback page, no OIDC login UI.

### Out of scope

- The gateway's other client-auth modes (mTLS, Edge JWT, plaintext) are not
  supported. The proxy-to-user leg is OIDC; the BFF-to-gateway leg is the
  forwarded JWT.
- **Token exchange** (RFC 8693): if it materializes, it lands in the
  proxy/platform layer, not in the BFF.

## History

Three approaches were tried:

1. **sessionStorage SPA tokens**: frontend held the JWT, sent
   `Authorization: Bearer`. Broke WebSocket auth (no headers on upgrades),
   exposed tokens to XSS, logout didn't work.
2. **In-BFF cookie custodian**: BFF ran PKCE, sealed tokens into
   AES-256-GCM `__Host-` cookies, refreshed server-side, enforced CSRF.
   Well-engineered per the IETF browser-based-apps BCP, but made the BFF an
   identity proxy (~1,500 lines, six endpoints).
3. **Relay-only**: the custodian's requirements (HttpOnly sessions, refresh,
   WS coverage, lifetime caps) are real — oauth2-proxy meets them on the
   other side of a network boundary. Every production deployment already
   fronted the BFF with a proxy; the custodian's only real consumer was a
   bare standalone install, which now ships oauth2-proxy instead.

The lesson: the BFF grew custody not because pipes inevitably do, but
because it was the only component present to meet a real need (browser
login). Fixing the *deployment shape* — proxy ships alongside — makes the
pure relay sustainable.

## Consequences

- The BFF's entire auth surface is ~50 lines of header reading. Auth bugs
  are proxy configuration or gateway configuration.
- Any standard OIDC IdP works via the proxy's config. The relay is
  indifferent to token format; the gateway's JWKS compatibility is a
  deployment concern, not BFF code.
- Beyond auth, the BFF stays out of: Kubernetes API calls, credential
  brokering (write-only pass-through), rate limiting / WAF (ingress layer),
  and server-side state (no session store, no database).
