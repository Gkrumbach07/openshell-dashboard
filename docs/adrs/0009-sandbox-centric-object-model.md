# ADR 0009: Sandbox-Centric Object Model

**Status:** Accepted
**Date:** 2026-08-04
**Authors:** Gage Krumbach

## Context

OpenShell's API has one execution primitive: the **sandbox**. A sandbox is a secure container with policy, providers, and network constraints. There is no separate "Agent" resource in the API.

Agent frameworks (OpenClaw, Hermes, ADK, OpenCode) create sandboxes as their execution environments. An "agent" is a sandbox with certain labels, a certain image, and certain provider attachments — but the API doesn't distinguish between a sandbox running an agent, a sandbox running a tool server, and a sandbox running a sub-agent session.

Early UX concepts proposed an agent-centric view: "My Agents" list, agent creation wizard, agent lifecycle management. This would require fabricating an Agent abstraction on top of sandboxes.

## Decision

The dashboard surfaces sandboxes as the fundamental object, matching the API. We do not invent an Agent resource.

- The sandbox list shows all sandboxes. Users can filter by labels to see "agent" sandboxes vs tool sandboxes vs other workloads.
- Sandbox creation uses the `CreateSandbox` API directly. The form exposes sandbox spec fields (image, policy, providers, labels) — not agent-centric abstractions like "choose your framework."
- The API is shown bottom-up: expose what exists, don't paper over it with wizards.

Labels and annotations on sandboxes can categorize workloads (agent, tool, sub-agent, CI runner, dev environment), but this is user-applied metadata, not a type system.

## Why not an Agent abstraction

- **No API backing.** There is no CreateAgent, ListAgents, or GetAgent RPC. Building an Agent abstraction means fabricating client-side state that diverges from what the gateway knows.
- **Sandboxes are more general than agents.** OpenShell is used for dev environments (Dev Spaces), CI runners (Tekton pipelines), tool servers, and harness evaluations. An agent-centric UI excludes these use cases.
- **Fix the API, don't hide it.** If the API has gaps (no agent grouping, no session linking), the right fix is upstream in the proto — not a client-side workaround that creates two sources of truth.

Derek Carr (OpenShell strategic lead), Jul 24 meeting: "Surface the API as-is. Show sandboxes, then let users filter to agents. Call things what they are."

## Consequences

- The UI uses "Sandbox" everywhere, not "Agent." Sandboxes are the top-level nav item.
- Label-based filtering (`openshell.io/type=agent`, `openshell.io/framework=openclaw`) is a first-class UI feature but not a type system.
- When upstream adds agent grouping or session linking, the dashboard can adopt it via the proto-sync process without rearchitecting the object model.
- Users familiar with agent-centric platforms (Bedrock, Vertex AI Agent Builder) may initially find the sandbox view unfamiliar. The documentation should explain the mental model.
