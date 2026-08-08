# ADR 0006: Proto Files as Source of Truth

**Status:** Accepted
**Date:** 2026-08-04
**Authors:** Gage Krumbach

## Context

The OpenShell gateway exposes 67 gRPC RPCs across two services (`OpenShell` and `Inference`). Early prototypes fabricated API concepts from K8s CRD patterns (sandbox stop/start, workspace policy library, OCSF events, member role update, Z3 verify button) that don't exist in the actual proto definitions.

We needed a rule to prevent this class of error permanently.

## Decision

**The proto files in `backend/proto/` are the single source of truth for what exists in the API.** Before writing any gateway wrapper, REST handler, or TypeScript type, read the actual RPC and message definitions. If a UI concept has no backing RPC, flag it — do not fabricate an endpoint.

Hard rules (codified in `.claude/rules/openshell-api.md`):

1. No sandbox stop/start/suspend/restart — lifecycle is create → ready/error → delete
2. No workspace-scoped named-policy resource — policy exists on sandbox spec and as gateway global config
3. Sandbox-scoped UpdateConfig may only change network_policies and inference fields
4. No OCSF events API — observability is GetSandboxLogs + WatchSandbox
5. No member-role-update RPC — role change requires remove + add
6. sandbox_id (UUID) vs name distinction for different RPCs
7. No Z3 verify RPC — prover verdicts appear only in PolicyChunk.validation_result
8. Provider model has no endpoint-URL/status/model fields — valid types come from ListProviderProfiles
9. No list-images API — sandbox images are free-text OCI refs
10. GetGatewayInfo returns only status, gateway_version, compute_drivers
11. Optimistic concurrency via expected_resource_version
12. Secret fields annotated with `[(openshell.options.v1.secret) = true]` — never serialize to frontend

## Why this matters

The OpenShell API diverges from patterns common in K8s-native services. Developers (human or AI) instinctively reach for K8s patterns (stop/start lifecycle, CRUD policy resources, events API) that don't exist. Every fabricated endpoint creates a handler that compiles, a test that passes, and a UI that looks correct — until it hits a real gateway and fails silently or returns errors.

A full audit against `NVIDIA/OpenShell/proto/` (Jul 29, 2026) removed dozens of fabricated concepts from the initial prototype.

## Consequences

- `make proto` regenerates Go stubs from `backend/proto/`. Proto files are manually synced from NVIDIA/OpenShell (see `proto-sync` skill).
- New features must start by reading the proto. If the RPC doesn't exist, the feature request goes upstream.
- The `.claude/rules/openshell-api.md` rule file is loaded into every AI coding session to prevent regression.
- We surface ~30 user-facing RPCs and skip ~37 internal/supervisor RPCs.
