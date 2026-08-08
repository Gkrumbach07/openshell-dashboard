# ADR 0002: Auth — Relay-Only BFF Behind a Fronting Proxy

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The dashboard runs in three deployment contexts (local dev, standalone
community installs, embedded in a hosting platform), and the OpenShell gateway
enforces its own RBAC using OIDC JWTs validated against its JWKS. Someone has
to get a JWT from the user's browser to the gateway on every request —
including WebSocket upgrades for the terminal.

We tried three answers in quick succession (see History), and landed here:

## Decision

**The BFF never terminates authentication.** A fronting auth proxy owns
login, sessions, refresh, logout, and CSRF in every authenticated
deployment. The BFF relays bearers and does nothing else with them.

### Modes

| Mode | Activation | Who terminates auth | Bearer source |
|------|-----------|--------------------|---------------|
| **Dev** | `AUTH_DISABLED=true` | nobody — synthetic `dev-user`, no token ever forwarded | none |
| **Standalone** | default | **oauth2-proxy** shipped alongside the BFF (compose `auth` profile / k8s sidecar), configured against the deployment's IdP | `x-forwarded-access-token` |
| **Federated** | default | the host platform's auth proxy | `x-forwarded-access-token` |

Standalone and federated are the **same architecture** with different proxy
operators — the BFF cannot and need not distinguish them. The only auth
switch is `AUTH_DISABLED`.

Bearer resolution (`backend/internal/auth/proxy.go`), identical everywhere:
`x-forwarded-access-token` → `Authorization: Bearer` (API clients) → 401.

### What the BFF never does with a token

1. **No termination.** No login flows, no OIDC endpoints, no cookies, no
   session state, no refresh, no logout logic.
2. **No validation.** No JWKS, no signature/issuer/audience checks, no JWT
   parsing, no `go-oidc` dependency. The gateway validates against its own
   JWKS; a second validator would drift, and its failures would masquerade
   as gateway rejections.
3. **No authorization.** The gateway enforces RBAC (platform role from JWT
   claims, workspace role from membership records). Frontend role display
   comes from the gateway's `GetCurrentUser`; hiding a nav item is UX, not
   enforcement.
4. **No ambient identity.** Every gRPC call carries the caller's bearer via
   per-RPC credentials. No service-account fallback. No bearer → the request
   fails.

### The deployment invariant

Unconditional trust in `x-forwarded-access-token` is safe only when the
proxy is the **sole network path** to the BFF (localhost sidecar,
pod-internal port, proxy-only ingress). This is the standard contract every
`x-forwarded-*` consumer lives under.
Manifests and the README must state and implement it; never expose the BFF
port directly in an authenticated deployment.

### Frontend behavior

The frontend reads `GET /api/v1/auth/config`
(`{authDisabled, adminRole, logoutUrl, features}`) and branches once:
`authDisabled` → dev login page ("Continue as developer"); otherwise render
the authenticated app — the proxy guaranteed a logged-in user before the
first byte of HTML arrived. On 401 (expired proxy session): full page reload
so the proxy re-authenticates, unless the host installed
`setSessionExpiredHandler`. No PKCE flow, no callback page, no OIDC login UI.

### Out of scope / future

- The gateway's other client-auth modes (mTLS, Edge JWT, plaintext) are not
  supported by the dashboard. The proxy-to-user leg is OIDC; the
  BFF-to-gateway leg is the forwarded JWT.
- **Token exchange** (RFC 8693 — swap a platform token for a gateway-scoped
  one): if it materializes, it lands in the proxy/platform
  layer where auth already lives, not in the BFF.

## History — how we got here (and why it's recorded)

1. **sessionStorage SPA tokens** (initial): frontend held the JWT, sent
   `Authorization: Bearer`. Broke WebSocket auth (no headers on upgrades),
   exposed tokens to XSS, logout didn't work.
2. **In-BFF cookie custodian** (PR #24): BFF ran PKCE, sealed tokens into
   AES-256-GCM `__Host-` cookies, refreshed server-side, enforced CSRF —
   well-engineered per the IETF browser-based-apps BCP, but it made the BFF
   an identity proxy (~1,500 lines, six endpoints), and hardening PRs
   immediately began accumulating to protect it.
3. **Relay-only** (PR #29, −2,000 lines): the custodian's requirements were
   all correct — HttpOnly sessions, rotation-safe refresh, WS coverage,
   lifetime caps — and oauth2-proxy has met them for years on the other side
   of a network boundary. Every production deployment already fronted the
   BFF with a proxy; the custodian's only real consumer was a bare
   standalone install, which now ships oauth2-proxy in its deployment
   instead.

The lesson worth keeping: the v1 "dumb pipe" failed not because pipes
inevitably grow custody, but because the BFF was the only component present
to meet a real need (browser login). Fixing the *deployment shape* — proxy
ships alongside — is what makes the pure relay sustainable. Proposals to
"just add" token awareness to the BFF should be read against this history.

## Consequences

- The BFF's entire auth surface is ~50 lines of header reading. Auth bugs
  are proxy configuration or gateway configuration.
- Any standard OIDC IdP works — via the proxy's config, not ours. The relay
  is indifferent to token format; what the *gateway* can validate is the
  only compatibility question — a gateway validating OIDC JWTs needs the
  fronting proxy to hand it JWTs from an issuer it trusts, which is a
  deployment configuration concern, not BFF code.
- `make dev-full` runs the dev gateway with unauthenticated users allowed;
  a one-command oauth2-proxy profile for a fully authenticated standalone
  stack is tracked as a follow-up.
- The scope boundary (ADR 0003) enforces this: "no auth termination" leads
  its never-list.
