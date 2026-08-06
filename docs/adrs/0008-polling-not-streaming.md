# ADR 0008: Polling, Not WebSockets

**Status:** Accepted
**Date:** 2026-08-04
**Authors:** Gage Krumbach

## Context

The OpenShell gateway has several streaming RPCs: `WatchSandbox` (server-stream), `ExecSandboxInteractive` (bidirectional), and `ForwardTcp` (bidirectional). A natural dashboard implementation would expose these as WebSocket connections from the frontend.

However, downstream federation constrains this. The odh-dashboard module federation proxy cannot handle WebSocket connections — it proxies HTTP requests only.

## Decision

No WebSockets anywhere in the stack. All real-time data uses HTTP polling via React Query's `refetchInterval`.

| Data | Polling interval | Mechanism |
|------|-----------------|-----------|
| Sandbox status | 5s | React Query `refetchInterval` on `GetSandbox` |
| Sandbox list | 10s | React Query `refetchInterval` on `ListSandboxes` |
| Sandbox logs | 3s | React Query `refetchInterval` on `GetSandboxLogs` |
| Gateway info | 30s | React Query `refetchInterval` on `GetGatewayInfo` |

The streaming RPCs (`ExecSandboxInteractive`, `WatchSandbox`, `ForwardTcp`) are deferred — not wrapped in the BFF. Users connect to sandboxes via the CLI (`openshell sandbox connect`), which is shown in the UI as a "Connect via CLI" card with a copy-paste command.

## Why not WebSockets for standalone mode only

Adding WebSockets in standalone mode and polling in federated mode creates two code paths for the same feature. The polling approach works identically in both modes. The added complexity of maintaining WebSocket support, connection management, reconnection logic, and mode-conditional transport is not justified by the latency improvement (5s polling vs real-time) for a dashboard UI.

## Consequences

- Sandbox status changes are visible within one polling interval (5-10s). This is acceptable for a dashboard — users don't need sub-second status updates.
- Log viewing has a 3s delay. This is noticeable but functional. The logs endpoint returns structured fields, so filtering works even with polling.
- Terminal/exec access is out of scope for the web UI. The CLI is the right tool for interactive sandbox sessions.
- If the federation proxy adds WebSocket support in the future, this decision can be revisited without breaking existing functionality.
