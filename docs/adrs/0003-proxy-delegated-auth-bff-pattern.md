# ADR 0003: Token Custody, Not Token Validation

**Status:** Accepted (v2 — supersedes "dumb pipe" framing of 2026-08-05)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The original version of this ADR called the BFF a "dumb pipe for tokens." That
was accurate when the only pattern was token relay. It stopped being accurate
the moment ADR 0010 landed: in standalone mode the BFF now runs the PKCE code
exchange, encrypts sessions with AES-256-GCM, refreshes tokens server-side
against the IdP, and enforces CSRF. A component that does all that is not a
dumb pipe, and pretending it is invites scope creep in the wrong direction —
"we already do OIDC, why not validate the JWT / check the role / mint a token?"

The line that matters was never "the BFF does nothing with tokens." It is:

## Decision

**The BFF takes custody of tokens when the mode requires it, but it never
validates them and never makes authorization decisions.**

Custody varies by pattern (ADR 0001):
- **Token relay** (federated): zero custody. Read header, forward, forget.
- **Session custodian** (standalone): full custody of *transport* — acquire
  via PKCE, seal into a cookie, refresh, destroy on logout. The BFF is doing
  the browser's old job more safely, not the gateway's job.

What is constant across every pattern:

1. **No validation.** No JWKS fetching, no signature checks, no issuer/audience
   verification, no `go-oidc` dependency. The one JWT read that exists —
   `jwtExpiry` pulling the unverified `exp` claim to schedule refresh — is
   bookkeeping about custody, not validation, and must stay that way.
2. **No authorization.** The gateway enforces RBAC (platform admin via roles
   claim, workspace roles via membership records). The BFF never inspects
   roles, never filters responses by user, never answers "may this user do X."
   The frontend reads roles from `/auth/whoami` for *display* purposes only —
   hiding a nav item is UX, not enforcement.
3. **Every gRPC call carries the caller's bearer.** Per-RPC credentials from
   request context. There is no service-account fallback, no ambient identity.
   If there is no bearer, the request fails at the gateway — the BFF does not
   soften this.

## Why this line and not another

- **Validation duplicated is validation skewed.** The gateway already validates
  against its JWKS with its own audience rules. A second validator in the BFF
  would drift (different clock skew, different audience config) and its
  failures would be indistinguishable from gateway rejections.
- **Authorization duplicated is authorization bypassed.** The
  SubjectAccessReview pattern used by k8s-backed BFFs (model-registry) makes
  sense when the downstream *is* k8s. Ours is not — the gateway has its own
  role model, and shadowing it in the BFF creates two sources of truth
  (ADR 0005 Option C documents why we rejected this).
- **Custody without validation is a coherent security posture.** oauth2-proxy
  does exactly this: it custodies sessions and validates nothing downstream.
  We follow the same IETF browser-based-apps BCP it does.

## Consequences

- The BFF's auth surface is bounded by ADR 0011 (BFF scope boundary). New
  auth-adjacent features must be justified against the custody/validation
  line, not against "we already have OIDC code."
- Standalone-only custody code (OIDC handler, session codec, session manager)
  should be separable from the relay path — a federated deployment should be
  able to reason about the BFF as if the custodian code weren't there.
  Extraction into an internal package with a narrow interface is a proposed
  issue.
- Defense-in-depth measures that ride on custody (CSRF origin checks, rate
  limiting on IdP-facing endpoints per PR #25) are acceptable *in front of*
  custody endpoints, but the primary control is always the deployment's
  ingress — the BFF's versions exist for standalone installs with nothing in
  front of them.
