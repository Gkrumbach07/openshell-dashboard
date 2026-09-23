---
description: OpenShell gRPC API reference for dashboard development — the vendored Go SDK is source of truth
globs: "backend/pkg/clients/**,backend/pkg/handlers/**,backend/pkg/services/**,frontend/src/api/**,frontend/src/types/**"
alwaysApply: false
---

# OpenShell API Reference

**THE VENDORED GO SDK IS THE SOURCE OF TRUTH.** Since the SDK migration (PR #43), the BFF calls `github.com/NVIDIA/OpenShell/sdk/go` directly and this repo carries no local proto mirror or generated stub tree. Before writing any handler or TypeScript type, read the actual RPC/message definitions in `$(go env GOMODCACHE)/github.com/!n!v!i!d!i!a/!open!shell/sdk/go@<version>/openshell/v1/` (hand-written client wrappers with doc comments; `types/*.go` for message shapes) or via `go doc`. Never invent RPCs, fields, or lifecycle states. If a UI idea has no backing RPC, flag it — do not fabricate an endpoint. Track upstream via `go get github.com/NVIDIA/OpenShell/sdk/go@latest`.

**One narrow exception remains.** `backend/pkg/clients/rawexec.go` uses the SDK's generated proto client for binary-safe file uploads because the public `Exec().Run(...)` API still does not accept raw stdin bytes when `tty=false`. Do not expand this escape hatch unless the public SDK still has a concrete gap you can point to.

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
6. **Sandbox operation identity is name + workspace scope.** User-facing sandbox operations — exec, logs, watch, SSH session creation — take the canonical sandbox *name* plus a typed `workspace_scope` (`datamodelv1.WorkspaceSelector`). Do not send `metadata.id` where the request message expects `sandbox`. This changed in the Sep 2026 SDK; the old `sandbox_id` field is gone.
7. **No Z3 verify RPC.** Prover verdicts appear only in `PolicyChunk.validation_result` on draft chunks.
8. **Provider model** (`datamodel.v1.Provider`): metadata, type (profile slug like "claude"/"gitlab"), credentials (map, `secret` option — strip before returning to browser), config (map), credential_expires_at_ms, profile_workspace. No endpoint-URL/status/model fields. Valid types come from `ListProviderProfiles`.
9. **No list-images API.** Sandbox images are free-text OCI refs; community images by convention `ghcr.io/nvidia/openshell-community/sandboxes/<name>`.
10. **`GetGatewayInfo` returns only** status, gateway_version, compute_drivers[]. No uptime/db/TLS/auth-mode fields.
11. **Optimistic concurrency:** `AttachSandboxProvider`, `DetachSandboxProvider`, `UpdateConfig`, `UpdateProviderProfiles` accept `expected_resource_version` — pass the ObjectMeta.resource_version from the last read. `ApproveDraftChunk` similarly takes a `review_token` (from the chunk's last `GetDraft` read) pinning the exact evaluated candidate; the BFF falls back to resolving it server-side if the client doesn't send one.
12. **Workspace scoping:** most requests carry a `workspace` field (empty = "default"); list RPCs offer `all_workspaces`. Workspaces themselves are top-level.
14. **`List` is paginated; use `ListAll` unless you are paging deliberately.** Since the Sep 2026 SDK, `List(...)` takes no `ctx` and returns a `*Pager[T]`. The eager form is `ListAll(ctx, ...)` returning a slice, and it is what every BFF handler uses. `ListMembers` likewise has `ListAllMembers`. `Policy().ListAll` takes `(ctx, workspace, sandboxName, opts...)` — pass `""` for both when listing global revisions.
15. **`Delete` returns `(*DeletionResult, error)`, and a nil error does not mean the resource is gone.** `DeletionOutcome` is one of Unspecified / Completed / Accepted / AlreadyAbsent. Only **Completed** and **AlreadyAbsent** establish completion; **Accepted** means the gateway queued asynchronous cleanup, and unrecognized numeric values must not be treated as completion. Convert through `models.FromSDKDeletion` rather than hardcoding `{"deleted": true}`.
16. **Network policy enum fields are proto enums, not free strings.** `access`, `enforcement` and `tls` on a policy network endpoint serialize through protojson as `NETWORK_ACCESS_PRESET_*`, `NETWORK_ENFORCEMENT_MODE_*`, `NETWORK_TLS_MODE_*`. The old lowercase spellings (`read-only`, `enforce`, `verify`) are no longer accepted by the gateway.

17. **Never bump the SDK on its own.** `sdk/go` is a submodule of `NVIDIA/OpenShell` — the same tree the gateway is built from — so the pin names an upstream commit and re-declares which gateways work. Per ADR 0005 the SDK pin, the gateway pins and the declared support range move together in one PR, proven by `make compat`. A gateway release tag resolves to its exact SDK (`v0.0.116` → `sdk/go@v0.0.0-20260828082717-d1155aa70042`).
18. **The SDK and the gateway are wire-coupled — they must be upgraded together.** The Sep 2026 SDK renumbered `CreateSandboxRequest`'s protobuf fields: `workspace_scope` moved from field 8 to field 7, which older gateways decode as the *string* `workload_template_name`. Symptom: every workspace-scoped call fails with `workspace '\n\adefault' not found` — that mangled name is the serialized `WorkspaceSelector` bytes (`0A 07 "default"`) being read as a string. Bumping `sdk/go` is therefore never a local-only change; verify with `make compat`.
19. **The gateway's TOML config is versioned and the schemas are mutually exclusive.** Releases up to `0.0.116` need `version = 1`; upstream HEAD (`dev`) needs `version = 2`, which renames `compute_drivers` (array) to `compute_driver` (string), switches `image_pull_policy` to snake_case (`if_not_present`), and drops `sandbox_namespace`. A v1 config on a v2 gateway fails to start outright. `deploy/ci/gateway.e2e.v1.toml.tmpl` / `.v2.` hold both; select with `OPENSHELL_CONFIG_SCHEMA`.
20. **`latest` is not the newest gateway.** On ghcr.io, `latest` is an alias for the newest *release* (as of this writing `0.0.116`, built 2026-08-28). `dev` tracks upstream HEAD and is the only tag that keeps pace with `sdk/go@latest`. Pin `dev` when you need a gateway matching a fresh SDK; do not assume `latest` means current.

13. **Secret fields** are annotated `[(openshell.options.v1.secret) = true]` in proto — grep for `secret` when adding a wrapper and never serialize those fields to the frontend.

## Auth per-RPC

User-facing RPCs require `Bearer` (OIDC JWT). `Health` is unauthenticated. Sandbox-only RPCs (ReportPolicyStatus, PushSandboxLogs, GetSandboxProviderEnvironment, SubmitPolicyAnalysis, ConnectSupervisor, RelayStream, GetInferenceBundle, IssueSandboxToken, RefreshSandboxToken) reject user principals — never wrap them.

## Streaming RPCs

`ExecSandboxInteractive` (bidi) — implemented via WebSocket relay in `pkg/handlers/terminal_handler.go`. `WatchSandbox` (server-stream) and `ForwardTcp` (bidi) — deferred; use `GetSandboxLogs` + `GetSandbox` polling instead.
