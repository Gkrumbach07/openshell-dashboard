---
description: OpenShell gRPC API reference for dashboard development — the vendored Go SDK is source of truth
globs: "backend/internal/sdkclient/**,backend/internal/api/**,frontend/src/api/**,frontend/src/types/**"
alwaysApply: false
---

# OpenShell API Reference

**THE VENDORED GO SDK IS THE SOURCE OF TRUTH.** Since the SDK migration (PR #43), the BFF calls `github.com/NVIDIA/OpenShell/sdk/go` directly — there is no local `backend/proto/` copy or `backend/gen/` anymore (both were removed; `backend/proto/*.proto` predates the migration and is stale/unused — do not edit or regenerate from it). Before writing any handler or TypeScript type, read the actual RPC/message definitions in `$(go env GOMODCACHE)/github.com/!n!v!i!d!i!a/!open!shell/sdk/go@<version>/openshell/v1/` (hand-written client wrappers with doc comments; `types/*.go` for message shapes) or via `go doc`. Never invent RPCs, fields, or lifecycle states. If a UI idea has no backing RPC, flag it — do not fabricate an endpoint. Track upstream via `go get github.com/NVIDIA/OpenShell/sdk/go@latest`.

## Services

| Service | SDK package | What we use |
|---------|-------------|-------------|
| `openshell.v1.OpenShell` | `openshell/v1` (`Client.Sandboxes()`, `.Workspaces()`, `.Providers()`, `.Policy()`, ...) | Sandbox (incl. stop/start), workspace, member, provider, profile, policy, draft policy, logs, SSH, services |
| `openshell.inference.v1.Inference` | `openshell/v1` (`Client.Inference()`) | Inference route CRUD |

Skip `GatewayInterceptor`, `SupervisorMiddleware`, `ComputeDriver` — internal/operator only.

## Hard facts — do not violate these

1. **Sandbox stop/start exists (as of v0.0.113); no suspend/restart.** `StopSandbox` retains persistent state; `StartSandbox` resumes. `SandboxPhase` = UNSPECIFIED, PROVISIONING, READY, ERROR, DELETING, STOPPING, STOPPED, STARTING, UNKNOWN. Lifecycle: Create → Ready/Error → (Stop ⇄ Start) → Delete. There is still no suspend/restart RPC and no "Suspended" state — do not invent those.
2. **No workspace-scoped named-policy resource.** Policy exists as: (a) `SandboxSpec.policy` — **required** on `CreateSandbox`, then versioned revisions per sandbox; (b) gateway-global via `UpdateConfig(global=true)`. No CreatePolicy/DeletePolicy/ListPolicies-by-workspace RPCs exist.
3. **Sandbox-scoped `UpdateConfig` may only change `network_policies` and inference fields.** filesystem/landlock/process are immutable after create — render read-only.
4. **No OCSF events API.** Observability = `GetSandboxLogs` (structured `fields` map on log lines) and `WatchSandbox` platform events. Never build an events query endpoint.
5. **No member-role-update RPC.** Role change = `RemoveWorkspaceMember` + `AddWorkspaceMember`.
6. **`sandbox_id` (UUID from `metadata.id`) vs name:** `ExecSandbox`, `ExecSandboxInteractive`, `GetSandboxLogs`, `WatchSandbox`, `CreateSshSession` take `sandbox_id`. CRUD RPCs take `name` + `workspace`. The BFF resolves name → id via `GetSandbox`.
7. **No Z3 verify RPC.** Prover verdicts appear only in `PolicyChunk.validation_result` on draft chunks.
8. **Provider model** (`datamodel.v1.Provider`): metadata, type (profile slug like "claude"/"gitlab"), credentials (map, `secret` option — strip before returning to browser), config (map), credential_expires_at_ms, profile_workspace. No endpoint-URL/status/model fields. Valid types come from `ListProviderProfiles`.
9. **No list-images API.** Sandbox images are free-text OCI refs; community images by convention `ghcr.io/nvidia/openshell-community/sandboxes/<name>`.
10. **`GetGatewayInfo` returns only** status, gateway_version, compute_drivers[]. No uptime/db/TLS/auth-mode fields.
11. **Optimistic concurrency:** `AttachSandboxProvider`, `DetachSandboxProvider`, `UpdateConfig`, `UpdateProviderProfiles` accept `expected_resource_version` — pass the ObjectMeta.resource_version from the last read. `ApproveDraftChunk` similarly takes a `review_token` (from the chunk's last `GetDraft` read) pinning the exact evaluated candidate; the BFF falls back to resolving it server-side if the client doesn't send one.
12. **Workspace scoping:** most requests carry a `workspace` field (empty = "default"); list RPCs offer `all_workspaces`. Workspaces themselves are top-level.
13. **Secret fields** are annotated `[(openshell.options.v1.secret) = true]` in proto — grep for `secret` when adding a wrapper and never serialize those fields to the frontend.

## Auth per-RPC

User-facing RPCs require `Bearer` (OIDC JWT). `Health` is unauthenticated. Sandbox-only RPCs (ReportPolicyStatus, PushSandboxLogs, GetSandboxProviderEnvironment, SubmitPolicyAnalysis, ConnectSupervisor, RelayStream, GetInferenceBundle, IssueSandboxToken, RefreshSandboxToken) reject user principals — never wrap them.

## Streaming RPCs

`ExecSandboxInteractive` (bidi) — implemented via WebSocket relay in `terminal_handler.go`. `WatchSandbox` (server-stream) and `ForwardTcp` (bidi) — deferred; use `GetSandboxLogs` + `GetSandbox` polling instead.
