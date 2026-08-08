# ADR 0003: The BFF Scope Boundary

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
and request hardening — with pending PRs adding rate limiting and HTTPS
enforcement on top.

Each addition was locally justified. Collectively they blurred what this
component *is*. The largest response was architectural — ADR 0002 removed
the entire identity layer (~1,500 lines, six endpoints, and the hardening
that was accumulating to protect it). This ADR bounds what remains, and is
the authority reviewers cite to keep it bounded.

## Decision

The BFF has exactly **three jobs**. Everything in the repo must trace to one
of them; anything that can't is out of scope regardless of how convenient
the BFF is as a place to put it.

1. **API translation.** REST↔gRPC for user-facing gateway RPCs: routing,
   DTO conversion, secret stripping, name→ID resolution, gRPC→HTTP error
   mapping, input validation at the boundary, file transfer streaming, and
   the terminal's WebSocket⇄bidi-stream relay — the terminal is the single
   sanctioned WebSocket, gated by `FEATURE_TERMINAL` for deployments whose
   transport can't relay it. The gateway's other streaming RPCs
   (`WatchSandbox`, `ForwardTcp`) stay unwrapped; status, lists, and logs
   are polled via React Query `refetchInterval`. This is the reason the BFF
   exists.
2. **Browser-app hosting.** Static SPA serving with index fallback, the
   `/auth/config` bootstrap contract (`authDisabled`, `adminRole`,
   `logoutUrl`, feature flags), and one WebSocket origin check. Auth
   termination, CSRF, and CORS are the fronting proxy's job (ADR 0002);
   the BFF is same-origin behind it.
3. **Operational surface.** Health/readiness probes, structured logging,
   graceful shutdown, gateway TLS setup.

### The never list

The BFF must never:

- **Terminate authentication** — no login flows, no OIDC endpoints, no
  session cookies, no refresh; the fronting proxy owns the browser
  relationship (ADR 0002)
- **Validate tokens** — no JWKS, no signature/issuer/audience checks, no
  JWT parsing (ADR 0002)
- **Make authorization decisions** — no role checks, no SAR/SSAR, no
  response filtering by user; RBAC is the gateway's
- **Call the Kubernetes API** — no client-go, no TokenReview, no CR reads;
  the BFF must run against a podman gateway on a laptop
- **Broker credentials** — no fetching, storing, or injecting provider
  secrets; write-only pass-through to the gateway, key names only on read
- **Mint or exchange tokens** — RFC 8693, if it comes, lands in the proxy
  layer or the platform, not here (see docs/design/federated-credential-bridge.md)
- **Manage users or workspace membership state** — the gateway owns
  membership; we call its RPCs
- **Rate-limit or WAF** — the proxy/ingress layer owns traffic policy
- **Hold server-side state** — no session store, no database, no cache
  requiring persistence or replica coordination

### What this rules on

| Proposal | Verdict |
|----------|---------|
| "Add a login page for standalone" | No — ship oauth2-proxy in the deployment (ADR 0002) |
| "Validate the JWT so we fail fast" | No — validation duplicated is validation skewed |
| "Check admin role to protect admin routes" | No — display-layer gating only; gateway enforces |
| "SSAR against sandbox CRs for RHOAI tenancy" | No — rejected Option C (see docs/design/federated-credential-bridge.md) |
| "BFF fetches a MaaS key and injects it as a provider credential" | No — credential brokering; gateway providers v2 / platform territory |
| "Rate-limit the auth endpoints" | Moot — there are no auth endpoints; ingress protects what exists |
| "Add Redis for cross-replica anything" | No — statelessness is load-bearing |
| "Serve the SPA and inject config" | Yes — job 2 |
| "Stream file uploads to the sandbox" | Yes — job 1 |

## Consequences

- Reviewers cite this ADR to reject scope creep without relitigating.
- The BFF is deliberately boring: with auth gone, the interesting surface
  is DTO fidelity and secret hygiene (`models.From*()`), which is where
  review attention belongs.
- PR #2 (SDK migration, ADR 0006) changes *how* job 1 talks gRPC, not the
  job list.
- If a platform auth layer (Praxis — see the design note) lands in front of
  everything, nothing here changes: the BFF was already designed as the
  thing behind a proxy.
