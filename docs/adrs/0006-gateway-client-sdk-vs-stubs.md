# ADR 0006: Gateway Client — SDK over Generated Stubs

**Status:** Proposed (accepting = merging PR #2 after conditions below)
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The BFF currently talks to the gateway through protoc-generated stubs
(`backend/gen/`, ~26K lines, committed) wrapped by a hand-written
`internal/gateway/` layer. This was a deliberate early decision: zero
dependency on any SDK's merge timeline.

Roland Huss has since built `openshell-sdk-go` and PR #2 migrates the BFF to
it: the entire `gen/` + `proto/` + `internal/gateway/` stack is replaced by
SDK sub-clients (net −26K lines, no protoc in the build). The SDK currently
lives in a personal repo (`rhuss/openshell-sdk-go`, v0.3.1) with a stated
intent to move into the OpenShell org. One functional gap is known (global
policy listing, SDK #44).

ADR 0005 ("surface the API as-is") is *not* at stake: it governs what API
concepts exist. Whether we reach those RPCs through our own stubs or an SDK is
an implementation question underneath it.

## Decision

**Adopt the SDK.** A community dashboard should consume the community's Go
client, not maintain a parallel 26K-line generated surface — every proto sync
we do by hand is work the SDK does for everyone. The BFF keeps its own thin
interface (`gateway.Interface` today) so handlers and tests never see SDK
types directly; the SDK is an implementation detail behind it.

**Conditions before merge:**

1. **Provenance:** the SDK moves to an org we can depend on (OpenShell org or
   equivalent), *or* we pin + vendor a tagged version so a personal-repo
   deletion cannot break our build.
2. **Parity:** SDK #44 (global policy listing) resolved or the feature
   explicitly flagged off until it is.
3. **Secret hygiene preserved:** the `models.From*()` secret-stripping layer
   survives the migration untouched — DTO conversion stays ours regardless
   of what client produces the protos (ADR 0003 job 1).

## Why not stay on stubs

- Manual proto sync (`proto-sync` skill) is a standing tax and a standing
  drift risk; the Jul 29 audit that caught fabricated RPCs exists because
  drift happens.
- 26K generated lines dominate the repo's Go surface and its diff noise.
- The SDK gives the community one place to fix client bugs; our wrapper layer
  gave only us one.

## Why not adopt unconditionally

A personal-repo dependency in the auth path of a security-sensitive dashboard
is a supply-chain judgment call. The conditions convert "trust Roland's repo"
into "trust a pinned artifact we control or an org-owned project."

## Consequences

- `make proto` and the `proto-sync` skill retire after migration; the
  `.claude/rules/openshell-api.md` hard-facts list remains (it documents API
  semantics, not stubs).
- `backend/proto/` goes away as a directory; ADR 0005's "source of truth"
  pointer moves to the upstream `NVIDIA/OpenShell/proto/` + SDK version pin.
- PR #2 needs a rebase over the relay-only auth (it predates PRs #24/#29); the
  per-RPC bearer forwarding moves to `sdkclient.ContextAuthProvider` and must
  be re-verified against all three auth modes before merge.
