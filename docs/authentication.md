# Authentication

The dashboard signs nobody in and decides nothing about access: an auth proxy in front of it signs users in, the BFF passes each user's token on, and the OpenShell gateway decides. [The install guide](install.md) sets this up with Keycloak.

```text
browser
   │  HTTPS, session cookie
   ▼
oauth2-proxy ── signs users in at ──▶ Keycloak
   │  X-Forwarded-Access-Token: <access token>
   ▼
BFF
   │  gRPC, authorization: Bearer <access token>
   ▼
OpenShell gateway ── checks the token against the issuer's keys
```

| Part | What it does |
| --- | --- |
| Keycloak | Holds users, groups and roles; issues the tokens |
| oauth2-proxy | The auth proxy, which the Helm chart runs as a sidecar. It runs the sign-in, keeps the session in a cookie, refreshes the token and adds the **access token** to every request it passes on |
| BFF | Takes the token from `x-forwarded-access-token`, or else from `Authorization: Bearer`, and sends it with every gateway call; with no token it answers 401. It validates nothing and authorizes nothing |
| Gateway | Validates the token, and enforces the roles in it and workspace membership |

The proxy forwards the access token, not the ID token (`--pass-access-token=true`, `--pass-authorization-header=false`): an ID token is addressed to the dashboard's own client, not to the gateway.

## What the token must contain

The auth proxy and the gateway use the same issuer. In the **access token** that issuer gives the dashboard's client:

- `iss` is the gateway's issuer.
- `aud` contains the gateway's audience.
- The gateway's roles claim holds the gateway's admin role or user role.
- `sub` identifies the user. Workspace memberships are keyed by it.

Never point the gateway's roles claim at `aud`: the audience says who a token is for, not what its user may do. [Step 2 of the install guide](install.md#2-check-a-token) checks a token before installing.

## Keycloak

- `oidc.provider: keycloak-oidc` makes oauth2-proxy read Keycloak's roles from the access token, and `oidc.allowedRoles` then admits only users with one of the listed roles (a client role is written `<client>:<role>`). That is a gate in front of the UI; the gateway still decides every call.
- `oidc.codeChallengeMethod: S256` goes with a client that requires PKCE.
- No audience mapper is needed when the roles are client roles of the client that is the gateway's audience (`openshell-api` in the guide): Keycloak's built-in `roles` client scope carries Audience Resolve, which adds a client to `aud` when the token holds one of its roles.

## Other OIDC providers

Keep `oidc.provider: oidc`, the default, and leave `oidc.allowedRoles` unset: the chart accepts it only with `keycloak-oidc`. `oidc.allowedGroups` limits who reaches the UI, if the provider puts a `groups` claim in the token. The provider supplies:

- a confidential client for oauth2-proxy, with the callback `https://<dashboard host>/oauth2/callback`;
- an access token that meets the list above, as a JWT: the gateway checks it against the issuer's keys;
- an `email` claim not marked unverified, or oauth2-proxy refuses the sign-in.

## Sessions, refresh and sign-out

- The session is oauth2-proxy's cookie, Secure and HttpOnly. The BFF keeps none.
- oauth2-proxy refreshes the access token every `authProxy.cookie.refresh` (default `2m`). Keep that below the provider's access-token lifetime, or the gateway refuses an expired token while the UI still looks signed in.
- On a 401 the UI reloads the page once, so the auth proxy can sign the user in again.
- Signing out sends the browser to `LOGOUT_URL` (`dashboard.logoutURL` in the chart, default `/oauth2/sign_out?rd=/oauth2/sign_in`), which ends the proxy's session. With provider `keycloak-oidc` the proxy also ends the Keycloak session; for other providers see [Sign-out](install.md#sign-out).

## The proxy is the only path to the BFF

A request that reaches the BFF directly can present any header. The chart prevents that: the BFF listens on `127.0.0.1`, the Service exposes the proxy's port only, and the NetworkPolicy admits traffic to that port only. Never publish the BFF's port, 8080.

## API clients and local development

- The BFF also accepts `Authorization: Bearer <access token>`, for a script or a test that reaches it directly. A chart install has no such path: its oauth2-proxy takes no bearer tokens (`--skip-jwt-bearer-tokens=false`), so every request needs a browser session.
- `AUTH_DISABLED=true` is for [local development](development.md#run-it-locally): the BFF acts as a made-up `dev-user`, forwards no token and ignores any on the request.
- A gateway can be set to accept users without a token. That too is for local development; on a shared gateway leave it off, as the gateway chart does by default.

The decisions are in [ADR 0002](adrs/0002-auth-relay-only-bff.md).
