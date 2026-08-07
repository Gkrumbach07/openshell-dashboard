# ADR 0014: Relay-Only BFF — Auth Termination Belongs to a Fronting Proxy

**Status:** Accepted (supersedes ADR 0010)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

ADR 0010 built a session custodian into the BFF for standalone deployments:
PKCE code exchange, AES-256-GCM encrypted cookies, transparent server-side
refresh, CSRF enforcement — ~1,500 lines plus six endpoints, engineered well
and following the IETF browser-based-apps BCP.

Then we asked who actually consumes it. Every production deployment already
terminates auth in a dedicated proxy: RHOAI fronts every BFF with
kube-auth-proxy; the secure-agent-workspace Validated Pattern deploys this
dashboard behind **oauth2-proxy** with a Keycloak PKCE client (two merged PRs,
verified live); our own docker-compose has an `auth` profile doing the same.
The built-in custodian's only real consumer was a bare standalone install
with nothing in front of it — and the moment PR #25 arrived adding rate
limiting and HTTPS enforcement *to protect the custodian's endpoints*, the
trajectory was clear: we were incrementally rebuilding oauth2-proxy inside a
dashboard backend.

The custodian also created a second auth pattern. Two patterns means two
trust stories, two sets of browser protections, mode-gated header trust
(`TrustProxyHeader`), and upgrade-time cookie machinery for WebSockets —
all of it BFF code to review, test, and harden.

## Decision

**The BFF never terminates authentication.** It relays bearers; a fronting
auth proxy owns login, sessions, refresh, logout, and CSRF in every
authenticated deployment.

- Bearer resolution: `x-forwarded-access-token` → `Authorization: Bearer` →
  401. No cookies, no session codec, no OIDC endpoints, no `SESSION_SECRET`,
  no `OIDC_*` configuration.
- **Standalone** deployments ship oauth2-proxy alongside the BFF (compose
  `auth` profile, and the same container in any k8s manifest). oauth2-proxy
  is configured with the deployment's IdP and its own client_id; it holds
  the encrypted session cookie and injects the JWT on every request —
  including WebSocket upgrades, which removes the BFF's upgrade-time cookie
  handling entirely.
- **Federated** deployments keep kube-auth-proxy exactly as before. Standalone
  and federated are now the *same* auth architecture with different proxy
  operators — the mode distinction is packaging, not pattern.
- **Dev** (`AUTH_DISABLED=true`) is unchanged: synthetic `dev-user`, no
  tokens, login page shows only "Continue as developer."
- Frontend: the PKCE flow, callback page, and OIDC login UI are deleted.
  A 401 from the BFF triggers a full page reload (letting the proxy
  re-authenticate) unless the host installed `setSessionExpiredHandler`.

### The trust requirement this creates

Trusting `x-forwarded-access-token` unconditionally is safe **only if the
proxy is the sole path to the BFF.** This is a deployment invariant, not
code: the BFF binds where only the proxy reaches it (localhost sidecar,
pod-internal port, proxy-only ingress). The README and deployment manifests
must state it; the compose profile and any Helm chart must implement it.
This is the standard contract every `x-forwarded-*` consumer (including
every other RHOAI BFF) already lives under.

## Why supersede ADR 0010 one day after merging it

Because the alternative is worse: carrying an in-house identity proxy
indefinitely to avoid admitting a one-day-old decision was aimed at the
wrong layer. PR #24's engineering isn't wasted — it identified every
requirement correctly (HttpOnly cookies, refresh rotation, WS coverage,
absolute lifetime) and those requirements all still hold; they are simply
met by oauth2-proxy, which has implemented them for years, on the other
side of a network boundary. The cost of the swap is one extra container in
bare-metal standalone installs. The benefit is that the BFF's entire auth
surface becomes ~50 lines of header reading.

## Consequences

- Deleted: `oidc_handler.go`, `session.go`, `session_manager.go` and tests;
  `/auth/discovery`, `/auth/token-exchange`, `/auth/session`; CSRF
  middleware; CORS allowlist machinery (same-origin-only, the proxy fronts
  everything); `TrustProxyHeader` mode-gating; frontend `oidc.ts`,
  `AuthCallbackPage`, OIDC login UI.
- PR #25's auth-endpoint hardening (rate limiting, issuer HTTPS enforcement)
  is obsolete — it protects deleted endpoints. Its CSS deletions remain
  wanted (ADR 0012).
- `make dev-full` runs the dev gateway with `allow_unauthenticated_users`
  and `AUTH_DISABLED=true` on the BFF (Keycloak still mints JWTs for the
  Bearer path). A one-command oauth2-proxy compose profile for a true
  authenticated standalone stack is a follow-up issue.
- `DEPLOYMENT_CONTEXT` is deleted — its only real job was gating the
  ephemeral `SESSION_SECRET`, which no longer exists. `/auth/config` is
  `{authDisabled, adminRole, logoutUrl, features}`.
- ADR 0011's job list shrinks: token custody is no longer a BFF job; "no
  auth termination" joins the never-list.
- If a future deployment genuinely cannot run a sidecar, the answer is a
  reverse proxy with an auth module in front of the container — not code in
  the BFF.
