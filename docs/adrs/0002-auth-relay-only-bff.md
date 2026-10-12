# ADR 0002: Authentication: a relay-only BFF behind an authenticating proxy

**Status:** Accepted
**Date:** 2026-10-11

## Context

The OpenShell gateway authenticates users with OIDC: it validates a JWT against its issuer's keys and enforces roles and workspace membership itself. Something has to carry the user's token from a browser to the gateway on every request.

## Decisions

1. **The BFF never terminates authentication.** An authenticating proxy in front of it owns sign-in, the session cookie, token refresh, sign-out and CSRF protection. The Helm chart runs oauth2-proxy for this, as a second container in the dashboard's pod.
2. **The BFF takes the bearer from one chain and forwards it.** First the `x-forwarded-access-token` header the proxy sets (`AUTH_TOKEN_HEADER` renames it), then an `Authorization: Bearer` header from an API client, otherwise `401`. Every call to the gateway carries that bearer as per-request credentials.
3. **The BFF does nothing else with a token.** It does not validate it: no JWKS, no signature, issuer or audience check, no JWT parsing. It does not authorize: the gateway enforces roles and membership. It keeps no session, cookie or refresh logic. Its only auth routes are `GET /api/v1/auth/config` and `GET /api/v1/auth/whoami`.
4. **There are two modes and one switch.** `AUTH_DISABLED=true` is for local development: a synthetic `dev-user`, no token forwarded, and any token on the request ignored. Every other deployment runs behind the proxy.
5. **The proxy is the only network path to the BFF.** A request that reaches the BFF directly can present any header. The chart enforces this: the BFF listens on `127.0.0.1`, the Service exposes the proxy's port only, and the NetworkPolicy admits traffic to that port only.
6. **The proxy and the gateway trust the same OIDC issuer.** The proxy forwards the access token, and the gateway has to accept it: its audience and its roles claim. Any OIDC provider works; the [install guide](../install.md) and the example values use Keycloak.
7. **The UI asks the gateway who the user is.** It reads `GET /api/v1/auth/config` once. With auth disabled it shows a developer sign-in page. Otherwise it calls `GET /api/v1/auth/whoami` before it renders anything else, and the roles it shows are the gateway's. Hiding a navigation item for a role is convenience, not enforcement. A `401` on a later request reloads the page once, so the proxy can sign the user in again. Sign-out goes to the proxy's sign-out address (`LOGOUT_URL`, `/oauth2/sign_out` by default). The UI has no login form, no callback page and no token in browser storage.
8. **The BFF is same-origin only.** It has no CORS middleware, and the terminal's WebSocket refuses a handshake from another origin.

## Limits

- A client certificate (`GATEWAY_CLIENT_CERT`, `GATEWAY_CLIENT_KEY`) secures the BFF's connection to a gateway that requires mutual TLS. It does not replace the user's bearer on a gateway that uses OIDC. On a gateway that authenticates by client certificate alone, every signed-in user reaches the gateway as that one certificate; the chart refuses a client certificate unless sign-in is restricted with `oidc.allowedGroups` or `oidc.allowedRoles`.

## Alternatives

- *Tokens held by the UI in `sessionStorage` and sent as `Authorization: Bearer`.* Exposed to script injection, unable to authenticate a WebSocket upgrade, and with no real sign-out.
- *A session kept by the BFF:* PKCE in the BFF, tokens sealed in cookies, refresh on the server, CSRF checks. Sound, but it turns the BFF into an identity proxy and repeats what oauth2-proxy does one hop earlier.
- *Validate the JWT in the BFF as well as in the gateway.* A second validator can drift from the first.

## Consequences

- A sign-in problem is a proxy or gateway configuration problem, not BFF code.
- The BFF is indifferent to the token's format and to the identity provider. What the gateway needs in the token is in [Authentication](../authentication.md#what-the-token-must-contain).
