# ADR 0008: Polling for Data, WebSocket for the Terminal Only

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The gateway has three streaming RPCs: `WatchSandbox` (server-stream),
`ExecSandboxInteractive` (bidi), and `ForwardTcp` (bidi). The original version
of this ADR said "no WebSockets anywhere in the stack; terminal access is via
the CLI." Reality overruled it: the interactive terminal shipped
(`/api/v1/workspaces/{ws}/sandboxes/{name}/terminal`, a WebSocket ⇄ gRPC
bidi-stream relay), PR #19 authenticated it, and the auth architecture treats WebSocket upgrades as a first-class request type (ADR 0003). An ADR that the
codebase contradicts is worse than no ADR.

The original constraint was real: a downstream federation proxy may not relay
WebSocket connections. The wrong conclusion was drawn from it — banning the
transport instead of gating the feature.

## Decision

**Polling is the default for all data. The terminal is the single sanctioned
WebSocket, feature-flagged so deployments whose transport can't carry it turn
it off.**

### Data: HTTP polling via React Query `refetchInterval`

| Data | Interval |
|------|----------|
| Sandbox status | 5s |
| Sandbox list | 10s |
| Sandbox logs | 3s |
| Gateway info | 30s |

`WatchSandbox` and `ForwardTcp` remain unwrapped. Status and logs are
polled — a dashboard does not need sub-second freshness, and polling works
through every proxy.

### Terminal: WebSocket, because nothing else can do the job

An interactive shell is bidirectional and latency-sensitive; there is no
polling equivalent. The relay lives in `terminal_handler.go`: authenticate the
upgrade (same bearer chain as every request — the fronting proxy validates
the upgrade and injects the header, per ADR 0003), resolve name → sandbox_id,
bridge stdin/stdout/stderr/resize/exit between the WebSocket and
`ExecSandboxInteractive`.

`FEATURE_TERMINAL` gates it. Standalone deployments default on. A downstream
consumer whose proxy cannot relay WebSockets sets `FEATURE_TERMINAL=false` and
the UI falls back to the "Connect via CLI" card. The feature flag — not the
transport ban — is the federation-compatibility mechanism.

## Why not WebSockets for status/logs too

Two code paths for the same data (WS in standalone, polling in federated) is
the complexity the original ADR rightly refused. The terminal doesn't create
two paths — it has exactly one implementation, present or absent. That is the
distinction that makes it acceptable where "WS for everything" is not.

## Consequences

- Status/log freshness is bounded by polling intervals. Acceptable for a
  dashboard.
- The terminal is the only place WebSocket-specific machinery (origin checks,
  upgrade-time cookie refresh) exists. Anyone proposing a second WebSocket
  must bring it through an ADR revision, not a PR.
- Whether the odh-dashboard federation proxy can relay WebSockets is an open
  question downstream (its e2e tooling recently gained WS support for
  `/wss/k8s` paths). If it can, federated deployments may enable
  `FEATURE_TERMINAL`; nothing in this repo changes either way.
- If upstream adds an events/watch UX need later, the answer starts at
  "poll it" and must argue its way out.
