# ADR 0010: Cookie-Based BFF Sessions for Standalone OIDC

**Status:** Accepted
**Date:** 2026-08-06
**Authors:** Gage Krumbach

## Context

Standalone OIDC mode originally used the SPA pattern: the frontend stored the
OIDC token in `sessionStorage` and sent it as `Authorization: Bearer` on every
API call. This conflicted with the BFF architecture and broke in practice:

- **WebSockets cannot send Authorization headers.** The terminal
  (`ExecSandboxInteractive` over a WebSocket relay) always failed with 401.
  PR #19 patched this with a WebSocket-only token cookie — a second auth
  mechanism bolted beside the first.
- **Tokens were exposed to JavaScript.** `sessionStorage` is readable by any
  same-origin script; an XSS payload could exfiltrate the token.
- **Logout was broken.** With no server-side session, logout depended on
  client code clearing storage, and the flow redirected to an oauth2-proxy
  path that does not exist in standalone deployments.

The IETF's *OAuth 2.0 for Browser-Based Applications* (Best Current Practice,
in the RFC Editor queue) recommends the BFF-with-cookies architecture for
sensitive applications and steers away from token-in-browser-storage patterns.
Issue #20 tracked this migration.

## Decision

Standalone OIDC mode uses **encrypted, HttpOnly session cookies** managed
entirely by the BFF. The browser never sees a token.

- After the PKCE code exchange (which the BFF already performed server-side),
  the BFF seals the ID/access token, refresh token, and expiry into an
  **AES-256-GCM encrypted cookie**: `__Host-openshell-session`, HttpOnly,
  Secure, SameSite=Strict, Path=/. This is the oauth2-proxy client-side
  session pattern — the same mechanism Red Hat deploys in front of
  odh-dashboard.
- Sessions larger than one cookie (Keycloak JWTs with many groups) are
  **chunked** across numbered cookies and reassembled on read, capped at 8
  chunks.
- The auth middleware resolves bearers in precedence order:
  `x-forwarded-access-token` header (federated) → `Authorization: Bearer`
  (API clients) → session cookie (standalone browsers). Cookies therefore
  authenticate **all** request types, including WebSocket upgrades — the
  PR #19 WebSocket-only gate is removed.
- **Refresh is server-side and transparent**: when a session's bearer is
  expired, the middleware refreshes against the IdP (serialized by a mutex —
  IdPs may rotate refresh tokens on use) and re-sets the cookie. The
  client-side refresh endpoint is removed.
- **CSRF**: SameSite=Strict is the primary defense; an Origin check on
  mutating methods is defense-in-depth. Requests without an Origin header
  (non-browser clients) pass — they cannot carry a browser's cookies.
- **Login state** is probed via `GET /api/v1/auth/session` (never touches the
  gateway, so a gateway outage does not log users out). The frontend keeps no
  auth state beyond the dev-mode flag.
- **`SESSION_SECRET`** derives the encryption key. It must be set explicitly
  in production — an auto-generated secret (dev fallback, logged loudly)
  means sessions do not survive restarts and multi-replica deployments
  cannot decrypt each other's cookies.

Federated mode (proxy header) and dev mode (`AUTH_DISABLED`) are unchanged.
The BFF still never **validates** tokens — the gateway remains the JWT
authority (ADR 0003's "dumb pipe", now with a lockbox).

## Alternatives considered

- **Server-side session store (opaque ID cookie).** Gives per-session
  revocation, but adds state — Redis or sticky sessions for HA. The encrypted
  cookie is stateless and survives multi-replica with a shared secret. If
  revocation becomes a requirement, the storage backend can change without
  changing this architecture (oauth2-proxy supports both).
- **Keep the SPA pattern + WS cookie patch.** Two mechanisms to reason about,
  tokens still exposed to XSS exfiltration, logout still client-trusted.
- **Token-Mediating Backend (TMB).** The BCP's lighter alternative still
  hands access tokens to the browser; nothing here needs that.

## Consequences

- WebSocket terminal auth works with no special handling — the cookie rides
  the upgrade handshake.
- An XSS payload can no longer steal tokens (HttpOnly). It could still ride
  the session while a tab is open; no browser storage scheme prevents that.
- Cookie size is bounded by the chunk cap (~30KB sealed) — beyond that the
  BFF rejects the session at login with a clear error.
- Logout clears the cookie server-side and redirects to the IdP end-session
  endpoint, clearing SSO state too.
- `POST /api/v1/auth/token-exchange` no longer returns tokens in its body;
  `POST /api/v1/auth/refresh` is removed. Consumers of the npm package that
  used these must upgrade in lockstep (the frontend and BFF ship in one
  image, so standalone deployments cannot skew).
