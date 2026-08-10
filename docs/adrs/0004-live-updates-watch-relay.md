# ADR 0004: Live Updates — WatchSandbox WebSocket Relay with Polling Fallback

**Status:** Accepted
**Date:** 2026-08-10
**Authors:** Gage Krumbach

## Context

The dashboard originally learned about sandbox and draft-policy changes only
by polling: sandbox detail every 5s, the draft inbox every 10s. Gateway-side
actions — a draft chunk landing from denial analysis, an auto-approval
(`proposal_approval_mode=auto`), a policy revision loading — took up to a
poll interval to appear, which users read as "I have to refresh."

The gateway already has a real-time primitive: `WatchSandbox`, a per-sandbox
server-streaming RPC (bearer auth, `sandbox:read`). Its watch bus fires on
every draft mutation and policy revision persist, and the stream can also
carry filtered log lines and platform events. The dashboard already relays
one streaming RPC over WebSocket (`ExecSandboxInteractive`, the terminal).

WebSockets do not work in every deployment: federated proxies that cannot
upgrade WS are exactly why `FEATURE_TERMINAL` exists.

## Decision

**Relay `WatchSandbox` over a WebSocket per open sandbox detail page, gated
by `FEATURE_LIVE_UPDATES`, with React Query polling as the automatic
fallback.**

- The BFF exposes `GET .../sandboxes/{name}/watch` (`watch_handler.go`),
  registered only when the flag is on. It resolves name → id, opens
  `WatchSandbox` with `follow_status` always on (logs opt-in via query
  params), and relays events as JSON `WatchEvent` frames converted through
  `models.From*()` so secret-stripping applies. Ping/pong keepalive detects
  half-dead proxy connections — unlike the terminal, a watch stream can be
  legitimately silent for minutes.
- The frontend `useSandboxWatch` hook owns the detail page's socket. React
  Query remains the single source of truth: snapshot events are pushed into
  the sandbox detail cache, everything else becomes debounced query
  invalidation. The logs tab opens its own socket with `logs=true`
  (`useSandboxLogStream`) so log streaming only runs while that tab is
  mounted; both hooks share one reconnecting-socket helper (`watchSocket.ts`).
- Queries accept `{ live }` and disable `refetchInterval` while the socket
  is open. Flag off, socket down, or repeated connect failures → intervals
  resume. There is no third mode: WebSocket-when-possible, polling otherwise.
- The server does not yet emit the proto's `DraftPolicyUpdate` payload; the
  relay forwards it for forward-compatibility but the hook keys off
  `sandbox` snapshots and `warning` frames.

## Alternatives considered

- **Shorter poll intervals** — multiplies request load for latency still
  bounded by the interval; rejected.
- **SSE from the BFF** — avoids WS-upgrade problems, but adds a second
  streaming transport next to the existing terminal WS for little gain.
- **One workspace-wide socket** — no upstream primitive; `WatchSandbox` is
  per-sandbox. List pages and the draft summary keep polling.

## Consequences

- Draft/policy changes appear sub-second after the gateway processes them
  (the in-sandbox denial aggregator's batching delay remains — that is
  upstream behavior).
- Latency is the win, not request volume: events are "changed" pings that
  drive refetches.
- One long-lived goroutine pair and gRPC stream per open detail page; the
  stream is torn down when the page unmounts or the socket dies.
- Deployments behind non-WS proxies set `FEATURE_LIVE_UPDATES=false` (or
  just let the hook give up) and silently keep today's polling behavior.
