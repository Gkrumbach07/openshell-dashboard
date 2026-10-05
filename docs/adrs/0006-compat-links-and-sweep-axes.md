# ADR 0006: Gateway Compatibility — Three Links Proven Separately, Two Sweep Axes

**Status:** Accepted
**Date:** 2026-10-05
**Authors:** Gage Krumbach
**Amends:** [ADR 0005](0005-gateway-version-compatibility.md)

## Context

[ADR 0005](0005-gateway-version-compatibility.md) decided to pin a supported
gateway range and prove it with `backend/test/compat`. It also treated the SDK
and the gateway as two halves of one upstream tree that must always move
together. Within two weeks that second idea produced three failures:

1. **A digest-pinned `dev` lane still drifted.** The required lane was a `dev`
   gateway pinned by digest, but a dev gateway pulls
   `ghcr.io/nvidia/openshell/sandbox:dev`, a moving tag, at runtime. Upstream
   changed the sandbox protocol and `main` went red on 2026-10-02 with no
   change on our side.
2. **A cached pass stood in for a different gateway.** Go's test cache cannot
   see the gateway behind the BFF, so a pass against one gateway was replayed
   as `ok (cached)` for the next.
3. **A compile error was reported as three incompatible gateways.** The sweep
   moved the SDK and the gateway to each release tag together. One changed SDK
   method broke the build at one call site, and the result was filed as "3
   releases need migration" (#75) for three gateways that work.

Measured on 2026-10-05 against real gateways:

| Dashboard | SDK | gw 0.0.116 | gw 0.1.0 | gw 0.1.1 | gw 0.1.2 | gw HEAD (0.1.3-dev.84) |
|---|---|---|---|---|---|---|
| 0.x (v0.2.0, v0.3.0) | `90dbe545` (2026-09-10) | works | fails | fails | fails | not measured |
| 1.x (`main`) | `d3480d2a` (v0.1.0-pre.8) | fails | works | works | works | works |
| 1.x (`main`) | `6648bd0c` (v0.1.2) | fails | works | works | works | works |

`main` against 0.0.116 fails every workspace-scoped call with
`workspace '\n\adefault' not found` (the protobuf field renumbering); 0.x
against 0.1.x fails with `workspace_scope is required`. No build spans both
sides. Two different SDK commits work with the same three gateways, so the SDK
and the gateway are not one version.

## Decision

1. **Three links, each proven separately.** The chain is
   gateway → SDK → BFF → UI.

   | Link | Proven by | Never inferred from |
   |---|---|---|
   | **wire:** gateway ↔ SDK | `backend/test/compat` against a real gateway, with `-count=1` | version numbers. The newest gateway is not assumed to work with the newest SDK, in either direction |
   | **source:** SDK ↔ BFF | the compiler, `go vet` and the unit tests | a compat run |
   | BFF ↔ UI | shipping both from one commit | — |

   A result always names the link it is about. A compile error is a source
   migration; it is never reported as a gateway problem.

2. **The supported range is the required lanes.** The floor is the lowest and
   the ceiling the highest `version` among the lanes with `required: true` in
   `deploy/ci/gateway-pins.json`. Both are *releases*, pinned by digest, and
   both run on every PR. The range is derived wherever it is needed and stored
   nowhere: the `floor` and `floor_release` keys are gone, and CI rejects a
   pins file that restates it. Today the range is 0.1.0 to 0.1.2.

3. **No `dev` pins.** A dev build is never a lane, with or without a digest.
   Upstream HEAD is looked at by the scheduled sweep, as early warning only.

4. **The SDK is pinned to the commit of an upstream release tag.** Never
   `@latest`, a branch or a pre-release tag. The pin is recorded twice, in
   `backend/go.mod` and in the `sdk` field of the pins file, and CI fails when
   they disagree.

5. **The sweep has two axes, and each holds the other side still.**

   | Axis | Held still | Varies | Question | Its PR changes |
   |---|---|---|---|---|
   | gateway | the SDK pin | the gateway image | which gateways does the code we ship today work with? | the pins file only: the ceiling lane moves, the floor lane stays |
   | SDK | the required lanes | the SDK | can we move to a newer SDK without losing a gateway we support? | `go.mod`, `go.sum` and the `sdk` field only |

   The gateway axis tests every release from the floor up. A release above
   the ceiling that passes moves the ceiling; the ceiling never moves past a
   release that failed. A failure inside or above the range is a wire
   incompatibility.

   The SDK axis has one possible target: the SDK at the newest release tag,
   when that is newer than the pin. It is built, vetted and unit-tested first.
   If that fails the result is a source migration and no gateway is consulted.
   If it passes, it runs against every required lane. Passing all of them opens
   a PR. Failing the floor is reported as "this SDK would drop gateway
   *floor*" and a person decides; the floor is never raised automatically.

   Both axes also probe upstream HEAD (the `dev` gateway, `sdk@latest`).
   Neither is ever pinned and neither ever opens a PR.

6. **An automated PR changes exactly one axis.** The workflow checks the
   pending diff against its axis before committing.

7. **Every compat run uses `-count=1`.**

8. **Gateway 0.0.116 is served by the 0.x maintenance line, not by `main`.**
   `main`'s floor is 0.1.0. Supporting an older gateway means a release from
   the 0.x line, not a lane here.

## Consequences

**Moving the SDK and moving the ceiling are separate PRs with separate
evidence.** When both are open, each was proven against `main` as it stood,
not against the other. Merge one, update the other branch so the required
lanes run on the combination, then merge the second.

**The BFF may sit on an older SDK than the newest gateway it supports.** That
is the normal state, not drift. What makes it safe is the ceiling lane, not a
matching version number.

**A failure says where to work.** Wire: that gateway and the code we ship do
not work together at run time, so the range excludes it until a newer SDK or a
change in the BFF makes the compat suite pass. Source: the BFF does not build
against that SDK, so edit BFF code; no gateway is involved. The sweep's issue
carries the compiler output for the second, so #75 cannot recur in that form.

**Unknown is not a result.** A sweep leg that does not report is neither a
pass nor a failure. It leaves the issue and that axis's PR untouched and turns
the run red.

**The sweep's decisions are code with tests.** Candidate discovery,
classification, the report and the pins edits live in `deploy/ci/sweep/`, and
their unit tests run on every PR. The workflow file only sets up, starts
containers and calls `gh`.

**Automated PRs do not get CI by themselves.** GitHub does not let a
workflow's default token start new workflow runs unattended. An optional
`SWEEP_TOKEN` secret removes the manual step; without it the PR says what to
press.

**Still open:** publishing the derived range with each dashboard release
(#66).

## What this replaces in ADR 0005

- **Decision 4, "Sweep upstream releases, not SDK versions."** Replaced by
  decision 5 above. It remains true that a release tag names an exact SDK
  commit, and that is how the SDK axis finds its one target. What is withdrawn
  is the conclusion that both halves should be taken from the same tag and
  that there is no SDK × gateway combination worth testing.
- **The rule that the pins move together** (decision 2: "one change bumps the
  SDK … sets the new floor/ceiling, and updates the matrix together").
  Replaced by decision 6. What remains of decision 2: an SDK bump is still not
  a plain dependency update, because it must pass every required lane first.
- **"The required lane may legitimately be an unreleased build."** Withdrawn
  by decision 3.
- **"A PR tests the pin."** It now tests two: the floor and the ceiling.
- **"The sweep is forward-only."** That guard existed because the sweep moved
  the SDK. The gateway axis does not, so it may be asked to look below the
  floor; the answer is informational and never a PR.

Everything else in ADR 0005 stands: declare a window and never claim `latest`,
prove compatibility rather than assert it, pin by digest, keep the pins
machine-readable, and report to one issue that is rewritten in place.

## References

- [ADR 0005](0005-gateway-version-compatibility.md) — the decision this amends
- `deploy/ci/gateway-pins.json` — the lanes and the SDK pin
- `deploy/ci/sweep/` — the sweep's logic and its tests
- `.github/workflows/compat-sweep.yml`, and the `compat-pins` and `compat` jobs in `ci.yml`
- `.claude/rules/openshell-api.md` hard facts 17-20
- #75 — the sweep report that conflated the two links
- #66 — publishing the supported range per release
