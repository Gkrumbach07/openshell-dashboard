# ADR 0011: The BFF Scope Boundary

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

An audit of `origin/main` (Aug 7) counted **22 distinct responsibilities** in
the BFF: REST↔gRPC translation, DTO conversion with secret stripping, input
validation, gRPC error mapping, OIDC discovery proxying, PKCE code exchange,
session encryption and chunking, transparent token refresh, RP-initiated
logout, CSRF origin enforcement, CORS, a third separate origin check for
WebSockets, the terminal stream relay, upgrade-time cookie handling, static
SPA serving, feature-flag bootstrap, file upload/download streaming,
name→ID resolution, health probes, gateway TLS setup, cache-control headers,
and request hardening. Pending PRs push further: rate limiting and HTTPS
enforcement (PR #25).

Each addition was locally justified. Collectively they blur what this
component *is*, and the blur has costs: three divergent origin-check
implementations, CORS headers that contradict the cookie-auth model, auth
endpoints that bypass the configurable base path, and reviewers who can no
longer say "that doesn't belong here" with authority.

This ADR is that authority.

## Decision

The BFF has exactly **four jobs**. Everything in the repo must trace to one of
them; anything that can't is out of scope regardless of how convenient the BFF
is as a place to put it.

1. **API translation.** REST↔gRPC for user-facing gateway RPCs: routing,
   DTO conversion, secret stripping, name→ID resolution, gRPC→HTTP error
   mapping, input validation at the boundary, and the terminal's
   WebSocket⇄bidi-stream relay (ADR 0008). This is the reason the BFF exists.
2. **Token custody** per the mode's pattern (ADR 0001/0003/0010): relay
   headers in federated; run PKCE + encrypted sessions in standalone; never
   validate, never authorize.
3. **Browser-app hosting** for standalone: static SPA serving, the
   `/auth/config` bootstrap contract, and browser-facing protections that
   only make sense when the BFF is the thing a browser talks to directly
   (CSRF origin checks, CORS, WebSocket origin checks — **one shared
   implementation**, not three).
4. **Operational surface:** health/readiness probes, structured logging,
   graceful shutdown.

### The never list

The BFF must never:

- **Validate tokens** — no JWKS, no signature/issuer/audience checks (ADR 0003)
- **Make authorization decisions** — no role checks, no SAR/SSAR, no
  response filtering by user; RBAC is the gateway's
- **Call the Kubernetes API** — no client-go, no TokenReview, no CR reads;
  the BFF is k8s-agnostic and must run against a podman gateway on a laptop
- **Broker credentials** — no fetching, storing, or injecting provider
  secrets; write-only pass-through to the gateway, key names only on read
- **Mint or exchange tokens for other services** — token exchange (RFC 8693),
  if it comes, is acquiring *our* gateway bearer (a custody pattern), not a
  service the BFF offers to others
- **Manage users or workspace membership state** — the gateway owns
  membership; we call its RPCs
- **Be the primary rate limiter / WAF** — ingress owns that; BFF-side
  limits on IdP-facing endpoints (PR #25) are defense-in-depth for
  bare standalone installs and must be documented as such
- **Hold server-side state** — no session store, no database, no cache that
  can't be lost on restart (the discovery-document TTL cache is fine;
  anything requiring persistence or replica coordination is not)

### Structural consequence: isolate the custodian

Job 2's standalone half (OIDC handler, session codec, session manager —
~600 lines) is the largest single source of "does too much" perception, and
it is dead code in federated deployments. It moves behind a narrow interface
in its own internal package (`internal/standaloneauth` or similar) with one
construction site in `main.go`. A federated operator auditing the BFF should
be able to establish "this entire package is inert here" from the wiring, not
from reading every handler. Proposed issue; not a rewrite, a relocation.

## What this rules on that was previously ambiguous

| Proposal | Verdict |
|----------|---------|
| "Validate the JWT so we fail fast before the gateway" | No — validation duplicated is validation skewed |
| "Check admin role in the BFF to protect admin routes" | No — display-layer gating only; gateway enforces |
| "SSAR against sandbox CRs for RHOAI tenancy" | No — that's the Option C we rejected (ADR 0005) |
| "BFF fetches MaaS API key and injects as provider credential" | No — credential brokering; belongs in gateway providers v2 / platform (Praxis) |
| "Add Redis so refresh works across replicas" | No — scale standalone by sticky sessions or accept re-login; statelessness is load-bearing |
| "Proxy the OIDC discovery doc" | Yes — custody support, browser CORS constraint, cached, bounded |
| "Rate-limit `/auth/token-exchange`" | Yes, as defense-in-depth with ingress named as primary (PR #25) |
| "Serve the SPA and inject config" | Yes — job 3 |

## Consequences

- Reviewers cite this ADR to reject scope creep without relitigating.
- The three origin-check implementations consolidate into one helper
  (proposed issue); CORS drops the stale `Authorization` allow-header and
  either supports credentials properly or documents same-origin-only.
- PR #2 (SDK migration) is orthogonal: it changes *how* job 1 talks gRPC,
  not the job list (ADR 0013).
- If the platform later provides an auth-owning layer in front of us
  (Praxis — ADR 0005 Option D), jobs 2 and 3 shrink toward zero in that
  deployment and the BFF degrades gracefully into jobs 1 and 4. That is the
  design intent: the BFF's scope is a ceiling that deployments may lower,
  never a floor they must raise.
