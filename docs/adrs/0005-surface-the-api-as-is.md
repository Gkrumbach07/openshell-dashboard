# ADR 0005: Surface the Upstream API As-Is

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

Two recurring failure modes threatened the dashboard's fidelity to OpenShell:

1. **Fabricated endpoints.** Early prototypes, built from K8s CRD instincts,
   invented API concepts that don't exist: sandbox stop/start/suspend, a
   workspace policy library, an OCSF events API, member role update, a Z3
   verify button. Every fabricated endpoint compiles, passes its mocked
   tests, and renders a plausible UI — until it hits a real gateway. A full
   audit against upstream (Jul 29) removed dozens of these.
2. **Fabricated abstractions.** Early UX concepts proposed an agent-centric
   view ("My Agents", framework wizards, agent lifecycle) — but OpenShell
   has one execution primitive, the **sandbox**, and no Agent resource.
   An Agent abstraction would be client-side state diverging from what the
   gateway knows.

Both are the same mistake at different altitudes: papering over the API
instead of surfacing it.

## Decision

**The upstream OpenShell API is the single source of truth for what exists —
for endpoints, fields, lifecycle states, and the object model.** The
dashboard surfaces it bottom-up. If a UI idea has no backing RPC, the feature
request goes upstream — we never fabricate an endpoint or an abstraction to
fill the gap.

Concretely:

- **Sandbox is the fundamental object.** The UI says "Sandbox," not "Agent."
  Labels and annotations (`openshell.io/type=agent`, `…/framework=openclaw`)
  categorize workloads as user-applied metadata with first-class filtering —
  but they are not a type system, and there is no invented Agent resource.
  (Derek Carr, Jul 24: "Surface the API as-is. Show sandboxes, then let
  users filter to agents. Call things what they are.")
- **The hard-facts list** in `.claude/rules/openshell-api.md` codifies the
  known traps (no stop/start lifecycle, no workspace-scoped policy resource,
  no events API, no member-role-update, sandbox_id-vs-name semantics, secret
  field annotations, …). It is loaded into every AI coding session and is
  the checklist for review.
- **Where "the API" physically lives is an implementation detail** — today
  it is proto files synced into `backend/proto/`; under ADR 0006 it becomes
  the pinned `openshell-sdk-go` version, generated from the same upstream
  protos. The principle is unchanged by the mechanism: before writing any
  wrapper, handler, or TypeScript type, read the actual upstream definition.

## Consequences

- New features start by reading the upstream API. If the RPC doesn't exist,
  the work item is an upstream issue, not a client-side workaround creating
  a second source of truth.
- When upstream adds concepts (agent grouping, session linking), the
  dashboard adopts them through the normal sync/SDK-bump process without
  rearchitecting.
- Users arriving from agent-centric platforms may find the sandbox view
  unfamiliar; docs explain the mental model rather than the UI pretending
  otherwise.
- We surface the ~30 user-facing RPCs and skip internal/supervisor RPCs.
