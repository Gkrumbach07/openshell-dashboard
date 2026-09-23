# ADR 0005: Gateway Version Compatibility — Pin a Range, Never Track Latest

**Status:** Accepted
**Date:** 2026-09-23
**Authors:** Gage Krumbach

## Context

The dashboard has three apparent versions: its own release, the
`github.com/NVIDIA/OpenShell/sdk/go` pin in `backend/go.mod`, and the gateway
a user actually runs. They are not independent.

`sdk/go` is a **submodule of `NVIDIA/OpenShell`**, the same repository the
gateway is built from. Our pin `v0.0.0-20260923091534-d3480d2a7efa` names an
upstream *commit*; a gateway image named `0.0.117-dev.259+gbed9e5eaf` names an
upstream *commit*. They are the client and server halves of one tree.

```
NVIDIA/OpenShell ──┬── sdk/go       → our go.mod pin      (client half)
                   └── gateway img  → what is deployed    (server half)
```

So there are really two versions: **ours**, and **a point in upstream's
history** that we and the deployer must agree on.

That agreement is load-bearing and brittle. In September 2026 a single
upstream window moved three things at once:

1. **gRPC wire format** — `CreateSandboxRequest` field renumbering
   (`workspace_scope` 8 → 7, where older gateways expect a string)
2. **Config schema** — v1 → v2 (`compute_drivers` → `compute_driver`,
   snake_case pull policy, `sandbox_namespace` dropped)
3. **Tag semantics** — `latest` is an alias for the newest *release*, not a
   moving pointer; `dev` tracks HEAD

None of it was caught by 76% statement coverage on the handlers, because a
mocked SDK always agrees with the SDK it was compiled against. The failure
reached a user as `workspace '\n\adefault' not found` — the serialized
`WorkspaceSelector` surfacing as a workspace name.

## Decision

**Pin a supported range. Never claim `latest`.**

1. **Declare a window, not a point.** Following the Kubernetes version skew
   model, a dashboard release supports `[floor, ceiling]` — the oldest gateway
   we support and the newest we have actually tested. `latest` is never a
   support claim, because it is a moving target nobody tested.

2. **An SDK bump is a support-range change, not a dependency update.**
   `go get sdk/go@latest` re-declares which gateways work. It never lands as a
   standalone commit. One change bumps the SDK, runs compat against candidate
   gateways, sets the new floor/ceiling, and updates the matrix together.

3. **Compatibility is proven, not asserted.** The range is whatever
   `backend/test/compat` passes against. Two jobs, two cadences:

   | Job | When | Blocking | Question |
   |-----|------|----------|----------|
   | `compat` | per PR | yes | do we still honor the range we promised? |
   | `compat-sweep` | scheduled | no | how far ahead can we move? |

4. **Sweep upstream releases, not SDK versions.** Because both halves come
   from one tree, a gateway release tag resolves to an exact matching SDK
   (`v0.0.116` → `d1155aa7` → `sdk/go@v0.0.0-20260828082717-d1155aa70042`).
   The sweep therefore walks *one* axis — release tags — taking both halves
   from the same tag. There is no SDK × gateway cross-product to explore.

5. **Cadence stays ours.** Most dashboard releases touch no upstream contract
   and ship without reference to any of this. Only a change to the supported
   range involves upstream.

## Consequences

**A moved floor is breaking for deployments, even when semver says patch.**
Our npm semver describes the API we expose to consumers. It does not describe
the gateway a deployment needs. Raising the floor can break a running
installation while looking like a patch, so the range must be published
separately — tracked in #66.

**The required lane may legitimately be an unreleased build.** As of this ADR
no released gateway carries the renumbered proto (every published release is
2026-08-28), so the required lane is pinned to a `dev` *digest* and the newest
release runs as an advisory canary. This inverts the healthy steady state — we
are pinned ahead of every release and probing backward instead of pinning to a
release and probing forward. It is explicitly temporary. The canary turning
green is the trigger to promote a released tag to the floor.

**Pin by digest, never by a moving tag.** `dev` moved twice in one afternoon
while this lane was being set up. A digest makes a run reproducible and makes
bumping a deliberate act.

**The sweep can cross a config-schema boundary.** `e2e-stack.sh` therefore
supports `OPENSHELL_CONFIG_SCHEMA=auto`, which tries v2 and falls back to v1
when the gateway rejects the config version. Without it a sweep stops dead at
the v1/v2 line.

## Alternatives considered

**Track `latest`.** What we effectively did before, and it hid the breakage:
the old job used `:latest`, cached it under a constant key, and was
`continue-on-error`, so CI silently tested whatever `latest` was when the cache
was first seeded, and could not fail regardless.

**Pin one exact gateway version.** Simple and reproducible, but a support
matrix of exactly one version is not useful to anyone deploying, and it gives
no signal about whether the next release works.

**Support N-2 releases unconditionally.** Attractive, but unearned — a wire
break like the field renumbering makes some windows impossible to honor. The
range has to be discovered by test, not promised in advance.

## References

- ADR 0003 — adopting the SDK, which created this coupling
- `.claude/rules/openshell-api.md` hard facts 17-19
- #65 — the compat matrix
- #66 — publishing the supported range per release
