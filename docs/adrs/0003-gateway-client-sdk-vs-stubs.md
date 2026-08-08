# ADR 0003: Gateway Client — SDK over Generated Stubs

**Status:** Proposed
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The BFF talks to the gateway through protoc-generated stubs (`backend/gen/`,
~26K lines, committed) wrapped by a hand-written `internal/gateway/` layer.
This was a deliberate early decision: zero dependency on any SDK's merge
timeline.

The community `openshell-sdk-go` replaces the entire `gen/` + `proto/` +
`internal/gateway/` stack with SDK sub-clients (net −26K lines, no protoc
in the build). The SDK currently lives in a personal repo with a stated
intent to move into the OpenShell org.

The "surface the API as-is" rule is *not* at stake: it governs what API
concepts exist. Whether we reach those RPCs through our own stubs or an SDK
is an implementation question underneath it.

## Decision

**Adopt the SDK.** A community dashboard should consume the community's Go
client, not maintain a parallel 26K-line generated surface. The BFF keeps
its own thin interface (`gateway.Interface`) so handlers and tests never see
SDK types directly; the SDK is an implementation detail behind it.

**Conditions before adoption:**

1. **Provenance:** the SDK moves to an org we can depend on, *or* we pin +
   vendor a tagged version so a personal-repo deletion cannot break our
   build.
2. **Parity:** any known SDK feature gaps are resolved or explicitly flagged
   off.
3. **Secret hygiene preserved:** the `models.From*()` secret-stripping layer
   survives the migration untouched.

## Why not stay on stubs

- Manual proto sync is a standing tax and drift risk.
- 26K generated lines dominate the repo's Go surface and diff noise.
- The SDK gives the community one place to fix client bugs; our wrapper
  layer gave only us one.

## Why not adopt unconditionally

A personal-repo dependency in the auth path of a security-sensitive dashboard
is a supply-chain judgment call. The conditions convert "trust a personal
repo" into "trust a pinned artifact we control or an org-owned project."

## Consequences

- `make proto` and proto sync tooling retire after migration; the API
  hard-facts list remains (it documents semantics, not stubs).
- `backend/proto/` and `backend/gen/` go away; the source of truth moves to
  the upstream proto files + SDK version pin.
- Per-RPC bearer forwarding must be re-verified against all auth modes
  after migration.
