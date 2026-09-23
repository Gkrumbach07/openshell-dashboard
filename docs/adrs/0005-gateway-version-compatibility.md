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

**A PR tests the pin and nothing else.** The pin is what the dashboard claims
to work with; proving that is the PR's job. Surveying other releases is the
sweep's job, on a schedule. An advisory lane pinned to an *older* release is
not a canary but a permanently failing job — the SDK only moves forward, so
that pairing can never come back into compatibility. Advisory lanes are only
worth adding where the state can actually change.

**The required lane may legitimately be an unreleased build.** As of this ADR
no released gateway carries the renumbered proto (every published release is
2026-08-28), so the pin is a `dev` *digest*. This inverts the healthy steady
state — we are pinned ahead of every release rather than pinned to a release
and probing forward. It is explicitly temporary: the sweep reporting a passing
release is the trigger to promote a released tag to the pin.

**Pin by digest, never by a moving tag.** `dev` moved twice in one afternoon
while this lane was being set up. A digest makes a run reproducible and makes
bumping a deliberate act.

**The sweep is forward-only, and the guard is enforced.** Sweeping *backwards*
past the current pin is not meaningful: the sweep moves the SDK and the gateway
together, and below the pin this repo uses SDK APIs that do not exist yet, so
the build fails before anything talks to a gateway. `discover` rejects a floor
below the current one rather than producing a result that needs explaining.

Two backward-looking questions are easy to conflate, and only one is real:

| Question | Meaningful | Answered by |
|----------|------------|-------------|
| Can we compile and run at an *older SDK*? | No — we have adopted newer APIs | nobody |
| Does our *current build* work against an older *gateway*? | **Yes** — this is the floor of the supported range | the `compat` matrix, by holding the SDK fixed and varying the gateway image |

The second is what an advisory lane in `gateway-pins.json` is for. The sweep
must not approximate it, because moving the SDK changes the experiment.

The sweep records three failure modes separately — the BFF did not compile, the
gateway did not start, and the compat suite failed — because only the last is a
compatibility result. With the guard in place, an all-build-failure sweep means
upstream removed or reshaped an API this repo depends on, which is real
migration work.

**The sweep probes upstream HEAD, but never pins to it.** Once the pin sits on
a release, the sweep's release-tag walk is blind to HEAD, so a regression there
stays invisible until it ships. Each sweep therefore also runs `dev` — purely
as early warning, flagged `bumpable: false`. A green HEAD must not open a bump
PR, because that would move the pin onto a moving tag and defeat the point of
pinning releases. Its SDK is taken at `@latest` rather than at the dev image's
exact commit, so the two may be skewed by however long ago the image was built;
that is inherent to tracking a moving tag.

**Each sweep produces actionable pieces, and a bump is not a migration.** They
have different lifecycles: a bump is mechanical and closes by merging a PR, a
migration needs investigation and closes when the incompatibility is resolved.
A run can produce either, both, or neither, so they are separate artifacts — a
`chore/compat-bump-<version>` PR and a singleton `compat-migrate` issue —
rather than one item that means different things on different weeks.

**The pins are machine-readable.** `deploy/ci/gateway-pins.json` is the single
source of truth: the `compat` matrix in ci.yml reads it, and the bump PR edits
it structurally. Keeping the pins inline in the workflow would have forced the
automation into YAML surgery, and would have left the SDK pin and the gateway
pins in two places that could drift.

**Failures are reported, not just opportunities.** The sweep's most valuable
output is not "you can move forward" but "upstream moved somewhere we cannot
follow". It reports four states: every newer release passes (bump to the
newest), every one fails (blocked — migration work needed), a mix (bump to the
highest that passes and keep tracking the rest), and nothing newer released.
Only the last is silent, and even then an already-open issue is refreshed so it
cannot go stale.

**The sweep reports to a singleton issue, not just to CI.** A weekly cron whose
output lands only in the Actions tab does not get read — that is the same
failure mode as the `continue-on-error` job this work replaced. The sweep
maintains one issue labelled `compat-sweep`, rewritten in place, carrying the
per-version table and the exact `go get` for the bump. It is scoped to open
issues, so closing it is the acknowledgement that the bump landed and the next
actionable result opens a fresh one.

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
