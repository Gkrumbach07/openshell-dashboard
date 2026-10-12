# Releasing

A release is started by a person. Nobody chooses its version: it is worked out
from the OpenShell release the branch is built on and the release tags that
already exist. Merging to `main` publishes nothing by itself, whatever the pull
request is titled. This page says how to cut a release, how its version is
worked out, what happens when you do, what each artifact ends up saying about
the gateways it supports, and what to do when a step fails.

The one release nobody has to ask for is the merge of `next`, the move to a new
OpenShell release; see [The one automatic release](#the-one-automatic-release).

## One version, three artifacts

A release `vX.Y.Z` is:

| Artifact | Where | Made by |
|---|---|---|
| GitHub release `vX.Y.Z`, and the git tag with it | this repository | `scripts/release/cut-release.mjs`, in `publish.yml` |
| Container image tags `X.Y.Z` and `X.Y` | `quay.io/gkrumbach07/openshell-dashboard` | `publish.yml`, by retagging the image CI already built |
| Helm chart `openshell-dashboard`, version `X.Y.Z` | `oci://ghcr.io/gkrumbach07/openshell-dashboard/helm-chart` | `publish.yml`, by packaging the chart at the released commit once the image is tagged |

The BFF and the UI ship together, so they share the version. Nothing is
published to npm; that package is retired
([ADR 0008](adrs/0008-retire-the-npm-package.md)).

## What decides the version

The gateway does. The console shares the gateway's minor release line
([ADR 0009](adrs/0009-console-release-policy.md)): console `0.1.x` is for
gateway `0.1.x`. So a version has two parts, and neither is chosen:

- **The line** is the major and minor number of the OpenShell release the
  branch pins: `release` in
  [`deploy/ci/gateway-pins.json`](../deploy/ci/gateway-pins.json). The same
  line is compiled into the BFF, and CI holds the two together.
- **The version** is `<line>.<n>`, where `n` is one more than the highest patch
  among the release tags `v<line>.*` that exist, and `0` when the line has no
  tag yet.

| The branch pins | Release tags that exist | The release is |
|---|---|---|
| `0.1.3` | none on `0.1` | `0.1.0` |
| `0.1.3` | `v0.1.0`, `v0.1.1` | `0.1.2` |
| `0.1.4` | `v0.1.0`, `v0.1.2` | `0.1.3`: a gap is not filled |
| `0.2.0` | `v0.1.0` to `v0.1.7` | `0.2.0` |
| `0.1.9`, on `release/0.1` | `v0.1.0` to `v0.1.7`, `v0.2.0` | `0.1.8` |

What follows from that:

- **The third number is the console's own.** It counts console releases on the
  line and has nothing to do with the gateway's patch number.
- **A console minor starts only when the gateway's does.** The first release
  after the pin moves to a new gateway minor is `X.Y.0`, because that line has
  no tag yet. There is no special case for it, and no other way to get one.
  Every other release is the next patch.
- **Only release tags of the line count.** A tag on another line is ignored,
  and so is any tag that is not exactly `vX.Y.Z` (`v0.1.4-beta.1`, `0.1.4`).
  The tags counted are the ones that exist, wherever they point: a patch cut
  from `release/0.1` after `main` moved to `0.2` counts for `0.1`.
- **A pre-release pin never releases.** Only `next` pins one.
- **Commit titles play no part in the number.** They are what the release
  notes list; see
  [CONTRIBUTING.md](../CONTRIBUTING.md#merging-does-not-release-the-title-is-the-release-note).

[`scripts/release/next-version.mjs`](../scripts/release/next-version.mjs) is
the arithmetic, and
[`scripts/release/cut-release.mjs`](../scripts/release/cut-release.mjs) reads
the pins and the tags and runs it.

Every `vX.Y.Z` tag in this repository was cut by this rule, starting with
`v0.1.0`.

**A tag that should not be there.** The rule counts every tag `vX.Y.Z` of the
line, whoever pushed it and wherever it points. A tag pushed by hand raises
the number. So does one of the
[tag names withdrawn on 2026-10-10](../README.md#which-dashboard-for-which-gateway),
pushed back from a clone that still has it. Nothing in the pipeline deletes or
moves a tag. What it can tell is whether the commit a counted tag points at
was built for the line. When it was not, a dry run warns about the tag, and a
real run refuses to release while it is counted.

## Cutting a release

1. Make sure CI has passed for the commit the branch points at. A release tags
   the image that CI run built, so a commit without a green run is refused.
2. Start the workflow: **Actions → Release → Run workflow**, on `main`. Leave
   **Dry run** ticked. There is nothing else to fill in.
3. Read the run. Its summary says which version it would cut, **which release
   tags that number was worked out from**, and the notes it would publish.
   Nothing has been published.
4. Start it again with **Dry run** cleared.

From a terminal:

```bash
gh workflow run publish.yml --ref main -f dry_run=true    # look first
gh workflow run publish.yml --ref main -f dry_run=false   # then publish
```

Things to know:

- **Check the tags it counted.** A tag that should not be there is the one way
  the version comes out wrong, and a dry run is where to see it.
- **Everything since the last release goes out together.** There is no way to
  release some commits and hold others back.
- **A commit is released once.** Run for a commit that already carries a
  release tag of its line, the workflow cuts nothing and succeeds.
- **A dry run publishes nothing at all.** That includes the image tags and the
  chart of a release that is already cut at the commit.
- **A new run is for the tip of the branch.** It is not a way to retry an
  earlier run: see [When something fails](#when-something-fails).
- **GitHub's *Latest* goes to the highest version.** A release is marked
  *Latest* only when no release tag with a higher version exists.

### The line before `main`'s

Once `main` has moved to a new gateway minor, the line before it gets critical
and security fixes from `release/<major>.<minor>`
([ADR 0009](adrs/0009-console-release-policy.md), decision 5). Start the same
workflow on that branch:

```bash
gh workflow run publish.yml --ref release/0.1 -f dry_run=true
```

The same computation gives that line its next patch. Three things differ from
a release of `main`:

- **Only that line's `X.Y` image tag moves.** `latest` does not, and neither
  does the tag of the line `main` is on. The GitHub release is not marked
  *Latest* either, once the newer line has a release.
- **The branch has to pin its own line.** `release/0.1` with a pin on `0.2` is
  refused.
- **The commit has to contain the newest release of its line.** The
  [Follow upstream](../.github/workflows/follow-upstream.yml) workflow creates
  `release/X.Y` from `main` before `next` merges, so for a while both are on
  the same line. A release cut from `main` in that window is not on the
  release branch, and a release from the branch would be numbered above it
  without containing it. The run says so; merge that release into the branch
  first.

Nothing is released from a release branch automatically.

### The one automatic release

`main` moves to a new OpenShell release by merging `next`: the branch the
[Follow upstream](../.github/workflows/follow-upstream.yml) workflow keeps one
commit ahead of `main`, with the gateway CI runs and the SDK the BFF is built
on moved to the new release
([ADR 0009](adrs/0009-console-release-policy.md), decisions 7 and 8;
[`deploy/ci/upstream/README.md`](../deploy/ci/upstream/README.md)). The whole
purpose of that merge is to change what the next release is built on and
declares, and it is the release most likely to be forgotten. So when it is
merged and CI has passed on `main`, `publish.yml` releases it without being
asked.

Which commits qualify is decided from where they came from, never from their
title ([`scripts/release/next-merge.mjs`](../scripts/release/next-merge.mjs)):
the commit was merged into `main` by a pull request whose head was the branch
`next` **in this repository**. A fork's branch of that name does not count, and
neither does a pull request *into* `next`.

Anything else is simply not released; cut it by hand if it should be. Three
things to know about the release cut this way:

- It carries every commit merged since the last release, like any release
  does. That includes whatever people put on `next` beside the pin move, which
  is the point: work that needed the new gateway ships with it.
- **Its version is worked out like any other.** A move to a newer patch of the
  same gateway line is the console's next patch. A move to a new gateway minor
  is `X.Y.0`, the first release of that line.
- It follows the merge only if CI passes for the commit `main` ends up on. If a
  second merge cancels that CI run, cut the release by hand.

## The pipeline

```
push to main, or to release/X.Y
   │
   ▼
ci.yml ── build ──► push-manifest ─────────────► image :sha-<7>
   │                     └── image-range   (reads it back: does it declare its line?)
   │
   ├── check-frontend, check-backend, e2e
   ├── compat (the gateway this branch pins), stable-release
   ├── release-tooling
   │
   └── on main: all green, and this commit is still the tip of main
   │                 └──► promote-latest ──────► image :latest  (same digest)
   │
   ▼
publish.yml   started by a person, on main or release/X.Y   (or: CI passed for the merge of next)
   │
   ├── cut-release.mjs ── version = <pinned line>.<next patch>
   │        └── GitHub release vX.Y.Z ─────────► git tag vX.Y.Z
   │
   └── a vX.Y.Z tag is on this commit ──► tag-image ──► image :X.Y.Z, :X.Y  (same digest)
                                              └──► publish-chart ──► chart X.Y.Z
```

Six properties are worth knowing:

- **The image is built once.** `latest`, `X.Y.Z` and `X.Y` are added later by
  `scripts/retag-image.sh`, which resolves `sha-<7>` to its digest and points
  the new tag at that digest. A released image is therefore byte for byte the
  one CI built for the commit that passed, not a later rebuild of the same
  source.
- **`latest` waits for everything.** `sha-<7>` and `pr-<n>` are pushed as soon
  as the build finishes, because they only say "this is what that commit
  built". `latest` moves only after every job in `ci.yml` has passed on `main`.
- **`latest` only moves forward, and no release moves it.** A workflow run can
  be re-run for thirty days and keeps the commit it was started for. So before
  it retags, `promote-latest` asks the remote whether its commit is still the
  tip of `main` (`scripts/branch-tip.sh`). If `main` has moved on, the job
  succeeds without touching the registry, and the run for the newer commit is
  the one that promotes.
- **A version tag is written once.** `scripts/retag-image.sh` refuses to point
  an existing `X.Y.Z` at a different digest, and pushes nothing when it
  refuses. `X.Y` and `latest` are the tags that are meant to move.
- **The release and its tag are one request.** `cut-release.mjs` creates the
  GitHub release, and GitHub creates the tag at the released commit with it.
  There is no step after which a tag exists without its release.
- **Nothing is released from a red commit.** A release asked for by hand is
  refused unless CI passed for that commit, the automatic one only starts
  after CI succeeds, and `latest` does not move either.

## The release notes

Two parts, written by
[`scripts/release/release-notes.mjs`](../scripts/release/release-notes.mjs):

- **The changes.** The title of every commit since the previous release, as it
  was merged, oldest first. With a squash merge that is the pull request's
  title. A commit whose type or scope is `ci` is left out. "The previous
  release" is the nearest release in the released commit's history, so the
  first release of a new line lists what changed since the last release of the
  line before. When there is no earlier release at all, a fixed sentence says
  so and the history is not listed.
- **Supported OpenShell gateways**, described below.

A dry run prints the notes exactly as a real run would publish them.

## What every release declares

The GitHub release and the container image each state the OpenShell gateway
release line the release is for and the Go SDK it was built against (#66,
[ADR 0009](adrs/0009-console-release-policy.md)). The Helm chart states nothing
of its own; by default it deploys the image of the same version. The line is
the major and minor number of the release that
[`deploy/ci/gateway-pins.json`](../deploy/ci/gateway-pins.json) names at the
released commit, written `0.1` and shown as `0.1.x`: every gateway release that
starts with those two numbers. One script derives it,
[`scripts/gateway-range.mjs`](../scripts/gateway-range.mjs), and everything
else calls that script:

| Artifact | What it carries | Written by |
|---|---|---|
| The version itself | its first two numbers are the line | `scripts/release/next-version.mjs` |
| GitHub release | a *Supported OpenShell gateways* section: the line, the gateway release it was built on and tested against, and the SDK. It also calls out a line that changed since the previous release | `supportedGatewaysNotes` in `scripts/release/release-notes.mjs` |
| Container image | labels `io.github.gkrumbach07.openshell-dashboard.gateway.line` and `.sdk` | build args in `ci.yml`'s `build` job, consumed by `deploy/Dockerfile`; `image-range` reads the pushed image back and fails if they are missing |
| README | the table under *Compatibility* | `scripts/readme-gateway-range.mjs --write`, run by whatever moves the pins (the Follow upstream workflow does it itself) and checked in CI |

The BFF in the image does not read the labels. The line it compares a gateway
with is compiled into the binary (`BuiltInGatewayReleaseLine` in
[`backend/pkg/models/gateway_release_line.go`](../backend/pkg/models/gateway_release_line.go)),
so an image built by another Dockerfile, or with no build args, still shows the
compatibility notice.

Two things have to agree with the pins file, and
`node scripts/gateway-range.mjs --check` fails when either does not:

- `backend/go.mod`: the `sdk` field must equal the SDK version there. Both are
  the SDK at the commit upstream tagged the pinned release with, and they move
  with the gateway images in one commit
  ([ADR 0009](adrs/0009-console-release-policy.md), decision 7).
- the line compiled into the BFF: it must be the line of the pinned release. A
  move to a newer patch of the same line changes nothing here. A move to a new
  minor changes the constant in the same commit.

**What a running dashboard says about itself.** The image is built before any
release is cut and is only given more tags afterwards, so no version number is
compiled into it. The About dialog shows what is true of every build: the
gateway release line it is for, which the BFF serves, and the commit it is
built from, which CI passes to the image build as `DASHBOARD_COMMIT`. An image
built without that build arg shows the line and no commit.

## When something fails

**Retry by re-running the run, not by starting a new one.** *Re-run all jobs*
and *Re-run failed jobs* keep the commit the run was started for. A run started
from *Run workflow* is for the tip of the branch at that moment: if the branch
has gained a commit since a release was cut, a new run cuts the next patch at
the new tip and does nothing for the release before it, which is then left
without its image tags and its chart.

**`Cut the release` refuses.** It says why, and nothing was created:

- *The branch pins a pre-release.* Only `next` does; the release is cut after
  `next` has moved to the stable release and merged.
- *The release branch pins another line than its own.*
- *The newest release of the line is not in this commit's history.* Either
  this is a second run for an old commit that later releases have passed, and
  there is nothing to do, or it is a release branch that `main` released past;
  see [The line before `main`'s](#the-line-before-mains).
- *A counted release tag was not built for the line* (a real run only; a dry
  run warns and carries on). The tag was not cut by this pipeline (see
  [What decides the version](#what-decides-the-version)), and the version
  would come out too high. A release cannot be renumbered once it is out, so
  the run stops.
  Delete the tag, then re-run the run. The merge of `next` is stopped the
  same way, and its run is re-run the same way once the tag is gone.

**`Cut the release` failed while creating the release.** `gh`'s own message is
in the log. The release and its tag are created in one request, so either both
exist or neither does. Check the releases page, then use *Re-run all jobs* on
that run: with neither it cuts the release, and with both it finds the tag and
carries on.

**The version it shows is not the one you expected.** Look at the tags the run
says it counted. A release tag on the line that should not exist raises the
number. Deleting a tag is a person's decision and is done by hand.

**`tag-image` failed, the release itself went out.** Use *Re-run failed jobs* on
that run. The job only needs the registry, and it is repeatable: it finds the
`vX.Y.Z` tag on the commit and points the image tags at the same digest again.

**The whole publish workflow is re-run after a release was cut.**
`cut-release.mjs` finds the release tag on the commit and cuts nothing. The
image step looks for the same tag and finds it. `X.Y.Z` already names that
image, so it is left alone. `X.Y` only moves when the release is the newest
patch of that line, so re-running an old release does not pull `X.Y` backwards.

**`tag-image` says `X.Y.Z` already names another digest.** Unless someone pushed
that tag by hand, the commit was built again after it was released. *Re-run all
jobs* on a released commit's CI run does that: the second build has a new
digest, because its labels carry the build time, and `sha-<7>` now points at
it. The release is not allowed to follow. `X.Y.Z` still names the image that
was released, nothing was pushed, and there is nothing to repair. To retry a
failed job of an old run, use *Re-run failed jobs*, which leaves a build that
passed alone.

**`tag-image` says it could not tell whether `X.Y.Z` exists.** The registry
answered the lookup with something other than "here it is" or "no such tag", so
the write-once check could not be made and nothing was pushed. Re-run the job.

**`promote-latest` failed.** `latest` stays on the previous good commit and CI is
red, so nothing is published. Re-run the job. If `main` has moved on in the
meantime the re-run stands down instead of retagging, which is the right
outcome: the newer commit's run promotes its own image.

**An older run of `main` is re-run.** It cannot move `latest`, for the reason
above. If its commit was merged from `next` and never released, it is released
now, unless a newer release of the line exists that it does not contain, in
which case the run is refused. One side effect to know about: CI runs on `main`
share a concurrency group that cancels the run in progress, so re-running an
older run while the newest one is still going cancels the newest. That commit
is then neither promoted nor released until its own run is re-run.

## Testing the release tooling

None of this needs a registry, a token or a docker daemon:

```bash
node scripts/gateway-range.mjs --check          # the gateway release line, and that the line in the BFF and the SDK in go.mod match the pins
node scripts/readme-gateway-range.mjs --check   # the README states it
node --test "scripts/**/*.test.mjs"             # the version, the notes, cutting a release (against throwaway repositories and a stand-in gh), the merged-from-next check, the shell in publish.yml, release detection, the tip check, retag and image check (against a stand-in docker)

# What a release of this checkout would be. It reads the checkout and creates nothing.
git fetch --tags origin
node scripts/release/cut-release.mjs --branch main --dry-run
```

The `release-tooling` job in `ci.yml` runs the first three on every pull
request, because the first real run of the release scripts is on `main`, after
the merge.

## What this pipeline does not do

- **It does not let anyone choose a version.** A number that should be
  different means a tag that should not exist, or a pin on the wrong line.
- **It does not delete or move a git tag.**
- **It releases from `main` and from `release/<major>.<minor>` only.** The
  dashboard for gateway `0.0.116` is the one-off release
  [`gateway-0.0.116`](https://github.com/Gkrumbach07/openshell-dashboard/releases/tag/gateway-0.0.116),
  made by hand. It has no version: its tag is not a `vX.Y.Z` tag, so nothing
  here counts it. No further release is planned for it (see *Compatibility* in
  the README).
- **It does not rebuild images for a release.** The version is decided after
  the image exists, so the image's own `org.opencontainers.image.version` label
  names the branch it was built from (`main`), not `X.Y.Z`. The tag is what
  carries the version.
