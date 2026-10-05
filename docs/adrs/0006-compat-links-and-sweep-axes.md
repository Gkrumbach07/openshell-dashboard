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
   `ghcr.io/nvidia/openshell/sandbox:dev`, a moving tag, at runtime. `main`
   went red on 2026-10-02 (the sandbox entered `ERROR`) with no change on our
   side.
2. **A cached pass stood in for a different gateway.** Go's test cache cannot
   see the gateway behind the BFF, so a pass against one gateway was replayed
   as `ok (cached)` for the next.
3. **A compile error was reported as three incompatible gateways.** The sweep
   moved the SDK and the gateway to each release tag together. One changed SDK
   method broke the build at one call site, and the result was filed as "3
   releases need migration" (#75) for three gateways that work.

Measured on 2026-10-05 against real gateways. HEAD was `0.1.3-dev.84`.

| Dashboard | SDK | gw 0.0.116 | gw 0.1.0 | gw 0.1.1 | gw 0.1.2 | gw HEAD |
|---|---|---|---|---|---|---|
| v0.2.0 | `387aea06` (2026-09-02) | works | not measured | not measured | fails | not measured |
| v0.3.0, and commit `5f09070` after it | `90dbe545` (2026-09-10) | **wrong, with no error** | fails | fails | fails | fails |
| 1.x (`main`) | `d3480d2a` (v0.1.0-pre.8) | fails | works | works | works | works |
| 1.x (`main`) | `6648bd0c` (v0.1.2) | fails | works | works | works | works |

Between 0.0.116 and 0.1.0 upstream replaced `string workspace` on every
request with a `WorkspaceSelector workspace_scope` message, in two steps, and
each row above is one side of one of them:

- **`main` against 0.0.116** fails every workspace-scoped call with
  `workspace '\n\adefault' not found`. Release 0.1.0 put the selector at the
  field numbers the old string had (`GetSandboxRequest` 2,
  `ListSandboxesRequest` 4, `ListProvidersRequest` 3), so a 0.0.116 gateway
  reads the serialized selector as the workspace *name*.
- **v0.3.0 against 0.0.116 fails silently.** Its SDK (the first step) sends
  the selector at *new* field numbers and no longer sends the string.
  Protobuf drops fields it does not know, so the gateway sees no workspace at
  all: a sandbox created under `/workspaces/team-a` lands in `default`, every
  workspace page lists `default`'s contents, and nothing errors.
- **v0.3.0 against 0.1.x and HEAD** fails with `workspace_scope is required`:
  0.1.0 looks for the selector at the old numbers and finds nothing there.
- **v0.2.0 against 0.0.116 works**, workspaces included: its SDK still sends
  the string. Against 0.1.2 it fails (`failed to decode Protobuf message:
  ListSandboxesRequest.workspace_scope`).

No build spans both sides. Two different SDK commits work with the same three
gateways, so the SDK and the gateway are not one version. And v0.3.0 works
correctly with no gateway at all, although nothing that had been run against
0.0.116 showed it.

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
   they disagree. CI cannot tell a release tag's commit from any other, so
   that half is checked by the sweep: a pin that is not on a release tag is
   reported in the issue as needing a person.

5. **The sweep has two axes, and each holds the other side still.**

   | Axis | Held still | Varies | Question | Its PR changes |
   |---|---|---|---|---|
   | gateway | the SDK pin | the gateway image | which gateways does the code we ship today work with? | the pins file only: the ceiling lane moves, the floor lane stays |
   | SDK | the required lanes | the SDK | can we move to a newer SDK without losing a gateway we support? | `go.mod`, `go.sum` and the `sdk` field only |

   **The gateway axis** tests every release from the floor up on a scheduled
   run. A release above the ceiling that passes moves the ceiling. The ceiling
   moves only through the unbroken run of passes directly above it: it never
   moves past a release that failed, and never past one the run has no result
   for (no published image, a leg that could not be set up, a leg that did
   not report). A failure inside or above the range is a wire
   incompatibility.

   A manual run may narrow the axis (`max_versions`: the newest N releases at
   or below the ceiling). The cap never removes a release above the ceiling,
   and a run that left part of the range out, or did not probe HEAD, never
   closes the issue: it did not look at everything the issue may be about.

   **The SDK axis** has one possible target: the SDK at the newest release
   tag, when that is newer than the pin. It is built, vetted and unit-tested
   first. If that fails the result is a source migration and no gateway is
   consulted. If it passes, it runs against every required lane. Passing all
   of them opens a PR. Failing the floor is reported as "this SDK would drop
   gateway *floor*" and a person decides; the floor is never raised
   automatically.

   Both axes also probe upstream HEAD (the `dev` gateway with the pinned SDK,
   and `sdk@latest` with the required lanes). Neither is ever pinned and
   neither ever opens a PR.

6. **An automated PR changes exactly one axis.** The workflow checks the
   pending diff against its axis before committing. The one thing either PR
   may touch beyond its axis is the block of `README.md` that restates the
   range and the SDK pin, between the `gateway-range` markers: that block is
   generated from the pins file and CI fails when it is stale, so the PR
   regenerates it. A README change outside the block is refused.

   This rule is about automated PRs and routine moves. The exception is a
   wire break that no build spans, like the one in the table above: the new
   SDK fails every required lane and the pinned SDK fails every new gateway,
   so neither single-axis PR can be green. Then a person moves the SDK and
   replaces the lanes in one PR that says so, the gateways left behind go to
   a maintenance line (decision 8), and the change is recorded here or in the
   release notes. The sweep never does this.

7. **Every compat run uses `-count=1`.**

8. **Gateway 0.0.116 is served by dashboard v0.2.0, not by `main` and not by
   v0.3.0.** `main`'s floor is 0.1.0. v0.2.0 (npm `openshell-dashboard@0.2.0`,
   image tag `sha-701454a`) is the last release that works with 0.0.116, so a
   fix for that gateway is a 0.2.x release cut from the `v0.2.0` tag. v0.3.0
   works correctly with no gateway and is not a base for anything.

9. **Automated PRs are `fix:` commits.** A moved ceiling changes the range
   every released artifact declares, and a moved SDK changes what the
   released BFF contains, so merging either cuts a release:
   `fix(compat): support gateway X` and
   `fix(sdk): move to the OpenShell SDK at vX`.

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

**The compat suite proves only what it varies, and it missed a silent
failure.** Nothing that was run against 0.0.116 caught v0.3.0 ignoring the
workspace on every request, because every test used the `default` workspace:
a field the suite never varied was dropped and nothing noticed. A request
that fails is loud; a field the gateway silently drops is not, and protobuf
drops unknown fields by design. It was found by a different kind of check:
a field-by-field diff of every request message between the gateway's proto
(at its release tag) and the proto the SDK was built from. That diff shows 3
silently ignored fields for v0.2.0's SDK against 0.0.116
(`CreateSandboxRequest.await_main_process_attachment`,
`CreateSandboxRequest.workload_template_name` and
`ExecSandboxRequest.no_login_shell`), 70 for v0.3.0's SDK, 67 of them the
workspace, and none for `main`'s SDK against 0.1.0, 0.1.1 and 0.1.2. Two
things follow. The suite has to vary what the dashboard sends, starting with
a non-default workspace. And **the request-field diff is not run
automatically yet**: the gateway axis runs the compat suite and nothing
else, so a release that silently drops a field the suite does not vary would
still pass it and could become the ceiling.

**Unknown is not a result.** A sweep leg that does not report is never read as
a pass or a failure, and neither are two legs that disagree about the same
check. What depends on the missing result is left alone: the gateway PR is
skipped when the leg is for a release above the ceiling, the SDK PR when it is
a lane of the release SDK and no other lane failed, and the issue is not
closed. A known failure elsewhere in the same run is still reported, and a
proposal that does not depend on the missing leg is still made. The run goes
red whenever a leg did not report.

**A failure before any request reaches a gateway is recorded as such.** An
image that cannot be pulled, a gateway that never becomes healthy, a BFF that
does not start, an SDK that cannot be fetched: each is a row that says what
happened, not a compatibility result and not a silent "re-run the sweep".

**The sweep's decisions are code with tests.** Candidate discovery,
classification, the report and the pins edits live in `deploy/ci/sweep/`, and
their unit tests run on every PR. The workflow file only sets up, starts
containers and calls `gh`.

**The job that can write runs nothing foreign.** The legs that run upstream
images and the candidate SDK hold a read-only token. The job that opens the
PRs holds `contents: write`, so it sets up no toolchain and starts no
container: the SDK PR's `go.mod` and `go.sum` are the files a passing leg
uploaded, copied in and checked as data. Only its `gh` and `git push` steps
are handed the token. It only ever rewrites or closes a pull request whose
head branch is in this repository.

**The sweep cannot open a pull request until the repository lets it.** One of
two things has to be true first, and as of 2026-10-05 neither is: the
repository setting *Allow GitHub Actions to create and approve pull requests*
is enabled, or a `SWEEP_TOKEN` secret exists (a fine-grained or GitHub App
token with Contents and Pull requests read/write). Until then a run with
something to propose fails in its PR job with a message naming both, deletes
the branch it pushed, and leaves no pull request to merge. With the setting
alone, CI does not start on the PR by itself and the PR says what to press;
with `SWEEP_TOKEN` it does.

**Still open:** publishing the derived range with each dashboard release
(#66), and running the request-field diff automatically.

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
- **"A mix (bump to the highest that passes and keep tracking the rest)."**
  The ceiling now advances only through the unbroken run of passes above it.
  A release that passes above one that failed is held, and no PR opens.
- **The HEAD probe's SDK, "taken at `@latest`".** The `dev` gateway is now run
  against the pinned SDK, on the gateway axis; `sdk@latest` is run against the
  required lanes, on the SDK axis. They are two questions.
- **A `chore/compat-bump-<version>` PR.** There are now two fixed branches,
  `compat-sweep/gateway` and `compat-sweep/sdk`, each rewritten in place, and
  their commits are `fix:` (decision 9). The issue no longer carries a
  `go get` line: the SDK PR carries the change.

What stands from ADR 0005: declare a window and never claim `latest`, prove
compatibility rather than assert it, pin by digest, keep the pins
machine-readable, and report to one issue that is rewritten in place.

## References

- [ADR 0005](0005-gateway-version-compatibility.md) — the decision this amends
- `deploy/ci/gateway-pins.json` — the lanes and the SDK pin
- `deploy/ci/sweep/` — the sweep's logic and its tests
- `.github/workflows/compat-sweep.yml`, and the `compat-pins` and `compat` jobs in `ci.yml`
- `.claude/rules/openshell-api.md` hard facts 17-20
- #75 — the sweep report that conflated the two links
- #66 — publishing the supported range per release
