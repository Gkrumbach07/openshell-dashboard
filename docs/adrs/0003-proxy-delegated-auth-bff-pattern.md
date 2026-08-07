# ADR 0003: The BFF Is a Token Relay

**Status:** Accepted (v3 — relay-only per ADR 0014; v2's "custody" framing applied while the BFF held sessions)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

v1 of this ADR called the BFF a "dumb pipe for tokens." ADR 0010 made that
false — the BFF took custody of sessions — so v2 redrew the line at "custody
without validation." ADR 0014 then moved custody out of the BFF entirely, to
a fronting auth proxy. The original doctrine is true again, and this version
states it with the boundaries that two rounds of drift taught us to make
explicit.

## Decision

**The BFF relays tokens. It never acquires, stores, validates, or authorizes
them.**

1. **Relay only.** Read the bearer from `x-forwarded-access-token` or
   `Authorization: Bearer`, store it in request context, forward it as gRPC
   `authorization: Bearer` metadata on every call. No cookies, no session
   state, no refresh logic, no logout flow — the fronting proxy owns all of
   that (oauth2-proxy standalone, kube-auth-proxy federated).
2. **No validation.** No JWKS, no signature/issuer/audience checks, no
   `go-oidc` dependency, no JWT parsing of any kind. The gateway validates
   against its own JWKS; a second validator would drift and its failures
   would masquerade as gateway rejections.
3. **No authorization.** The gateway enforces RBAC (platform role from JWT
   claims, workspace role from membership records). The BFF never inspects
   roles, never filters responses by user, never answers "may this user do
   X." Frontend role display comes from the gateway's `GetCurrentUser`, and
   hiding a nav item is UX, not enforcement.
4. **Every call carries the caller's bearer.** No service-account fallback,
   no ambient identity. No bearer → the request fails, first at the BFF
   (401), definitively at the gateway.

## Why this holds now when it didn't before

v1's dumb pipe failed because standalone deployments had a real need —
browser login — and the BFF was the only component present to meet it. The
lesson wasn't "pipes grow custody"; it was "don't be the only component
present." ADR 0014 fixed the deployment shape (proxy ships alongside the
BFF), which is what makes the pure relay sustainable rather than aspirational.

## Consequences

- Auth bugs are proxy configuration or gateway configuration; BFF auth code
  is small enough to exclude by inspection.
- The relay works identically for opaque tokens, JWTs, and anything else a
  proxy injects — the credential-bridge question (ADR 0005) is entirely
  about what the *gateway* can validate, never about BFF code.
- Scope enforcement lives in ADR 0011's never-list; proposals to "just add"
  token awareness cite this ADR's history as the cautionary tale.
