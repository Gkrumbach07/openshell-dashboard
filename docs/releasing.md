# Releasing

A release is cut by a person, who chooses whether it is a patch, a minor or a
major. Merging to `main` publishes nothing by itself, whatever the pull
request is titled. This page says how to cut one, what happens when you do,
what each artifact ends up saying about the gateways it supports, and what to
do when a step fails.

The one release nobody has to ask for is the merge of `next`, the move to a new
OpenShell release; see [The one automatic release](#the-one-automatic-release).

## One version, three artifacts

A release `vX.Y.Z` is:

| Artifact | Where | Made by |
|---|---|---|
| GitHub release `vX.Y.Z` | this repository | `semantic-release`, in `publish.yml` |
| Container image tags `X.Y.Z` and `X.Y` | `quay.io/gkrumbach07/openshell-dashboard` | `publish.yml`, by retagging the image CI already built |
| Helm chart `openshell-dashboard`, version `X.Y.Z` | `oci://ghcr.io/gkrumbach07/openshell-dashboard/helm-chart` | `publish.yml`, by packaging the chart at the released commit once the image is tagged |

The BFF and the UI ship together, so they share the version. Nothing is
published to npm; that package is retired
([ADR 0008](adrs/0008-retire-the-npm-package.md)).

## Cutting a release

1. Make sure CI has passed for the commit `main` points at. A release tags the
   image that CI run built, so a commit without a green run is refused.
2. Start the workflow: **Actions → Release → Run workflow**, on `main`.
   Choose **patch**, **minor** or **major**. Leave **Dry run** ticked.
3. Read the run. Its summary says which version it would cut and how your
   choice compares with what the commit titles suggest; the log has the release
   notes. Nothing has been published.
4. Start it again with the same choice and **Dry run** cleared.

From a terminal:

```bash
gh workflow run publish.yml --ref main -f release_type=minor -f dry_run=true    # look first
gh workflow run publish.yml --ref main -f release_type=minor -f dry_run=false   # then publish
```

Things to know:

- **You choose the kind of release; the commits only advise.** The run reports
  what the titles since the last release suggest (the table is in
  [CONTRIBUTING.md](../CONTRIBUTING.md#merging-does-not-release-the-title-still-matters)).
  Choosing something *smaller* than they suggest is allowed and gets a warning,
  because it can ship a breaking change to people who only accept patches.
- **The first choice in the list is not a release type.** GitHub preselects
  the first option, so it is "(choose one)", and the run fails until you pick.
- **Everything since the last release goes out together.** There is no way to
  release some commits and hold others back.
- **With no commits since the last release it does nothing,** and succeeds.

### The one automatic release

`main` moves to a new OpenShell release by merging `next`: the branch the
[Follow upstream](../.github/workflows/follow-upstream.yml) workflow keeps one
commit ahead of `main`, with the gateway CI runs and the SDK the BFF is built
on moved to the new release
([ADR 0009](adrs/0009-console-release-policy.md), decisions 7 and 8;
[`deploy/ci/upstream/README.md`](../deploy/ci/upstream/README.md)). The whole
purpose of that merge is to change what the next release is built on and
declares, and it is the release most likely to be forgotten. So when it is
merged and CI has passed on `main`, `publish.yml` cuts a patch for it without
being asked.

Which commits qualify is decided from where they came from, never from their
title ([`scripts/release/next-merge.mjs`](../scripts/release/next-merge.mjs)):
the commit was merged into `main` by a pull request whose head was the branch
`next` **in this repository**. A fork's branch of that name does not count, and
neither does a pull request *into* `next`.

Anything else is simply not released; cut it by hand if it should be. Three
things to know about the patch cut this way:

- It carries every commit merged since the last release, like any release
  does. That includes whatever people put on `next` beside the pin move, which
  is the point: work that needed the new gateway ships with it.
- **It is a patch even when the move starts a new gateway minor.** By
  [ADR 0009](adrs/0009-console-release-policy.md) that release should be a
  minor; working the version out from the move is not built yet. The pull
  request says so when it applies.
- It follows the merge only if CI passes for the commit `main` ends up on. If a
  second merge cancels that CI run, cut the release by hand.

## The pipeline

```
push to main
   │
   ▼
ci.yml ── build ──► push-manifest ─────────────► image :sha-<7>
   │                     └── image-range   (reads it back: does it declare its line?)
   │
   ├── check-frontend, check-backend, e2e
   ├── compat (the gateway this branch pins), stable-release
   ├── release-tooling
   │
   └── all green, and this commit is still the tip of main
   │                 └──► promote-latest ──────► image :latest  (same digest)
   │
   ▼
publish.yml   started by a person, with a release type   (or: CI passed for the merge of next)
   │
   ├── semantic-release ───────────────────────► git tag vX.Y.Z
   │                                             GitHub release vX.Y.Z
   │
   └── a vX.Y.Z tag is on this commit ──► tag-image ──► image :X.Y.Z, :X.Y  (same digest)
                                              └──► publish-chart ──► chart X.Y.Z
```

Five properties are worth knowing:

- **The image is built once.** `latest`, `X.Y.Z` and `X.Y` are added later by
  `scripts/retag-image.sh`, which resolves `sha-<7>` to its digest and points
  the new tag at that digest. A released image is therefore byte for byte the
  one CI built for the commit that passed, not a later rebuild of the same
  source.
- **`latest` waits for everything.** `sha-<7>` and `pr-<n>` are pushed as soon
  as the build finishes, because they only say "this is what that commit
  built". `latest` moves only after every job in `ci.yml` has passed on `main`.
- **`latest` only moves forward.** A workflow run can be re-run for thirty days
  and keeps the commit it was started for. So before it retags,
  `promote-latest` asks the remote whether its commit is still the tip of
  `main` (`scripts/branch-tip.sh`). If `main` has moved on, the job succeeds
  without touching the registry, and the run for the newer commit is the one
  that promotes.
- **A version tag is written once.** `scripts/retag-image.sh` refuses to point
  an existing `X.Y.Z` at a different digest, and pushes nothing when it
  refuses. `X.Y` and `latest` are the tags that are meant to move.
- **Nothing is released from a red `main`.** A release asked for by hand is
  refused unless CI passed for that commit, the automatic one only starts
  after CI succeeds, and `latest` does not move either.

## What decides the version

The person who starts the workflow. `release.config.cjs` loads
[`scripts/release/release-type-plugin.mjs`](../scripts/release/release-type-plugin.mjs)
in place of semantic-release's commit analyzer; it releases the type it is
given and refuses to run without one. Commit titles are still read, for two
things:

- **The release notes.** They are written from the titles: `feat` under
  *Features*, `fix` and `perf` under *Bug Fixes*, a `!` or a
  `BREAKING CHANGE:` footer under *BREAKING CHANGES*. A commit whose type or
  scope is `ci` is left out altogether.
- **The suggestion.** The same titles are what the run reports as "the commits
  suggest a … release".

`scripts/release/check-release-config.mjs` checks that the two agree: a sample
commit is in the notes exactly when it suggests a release, and nothing but the
release-type plugin can decide one.

It used to be the other way round: semantic-release decided from the titles and
published on every merge to `main`. That made choosing a pull request title the
same act as publishing. Versions 1.0.1 to 1.1.0 were each published by a
`fix(ci)` or `feat(ci)` commit that changed nothing in the package, and 1.0.0
by a single `BREAKING CHANGE:` footer nobody meant as a milestone.

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
| GitHub release | a *Supported OpenShell gateways* section: the line, the gateway release it was built on and tested against, and the SDK. It also calls out a line that changed since the previous release | `generateNotes` in `scripts/release/gateway-range-plugin.mjs` |
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

**Release `1.2.0` declares a range of gateway versions instead of a line.** It
was cut before ADR 0009: its notes state a range, and its image carries env
`GATEWAY_SUPPORTED_MIN` / `GATEWAY_SUPPORTED_MAX` and labels `.gateway.min` /
`.gateway.max`. **Releases up to and including `1.1.1` have none of this.** They
were cut by the previous pipeline: no *Supported OpenShell gateways* section,
nothing on the image, and no `X.Y.Z` or `X.Y` image tag. Nothing here changes a
release after the fact.

The dashboard's own version number does not yet describe the gateway a
deployment needs: `1.x` is for gateway `0.1.x`. ADR 0009 decides that the two
will share a minor release line; until that is implemented, the release notes
and the image label are where the line is stated, and the notes say so
explicitly when a release moves to another line.

## When something fails

**`tag-image` failed, the release itself went out.** Use *Re-run failed jobs* on
that run. The job only needs the registry, and it is repeatable: it finds the
`vX.Y.Z` tag on the commit and points the image tags at the same digest again.

**The whole publish workflow is re-run after a release was cut.**
`semantic-release` finds nothing new and does nothing. The image step still
looks for a release tag on the commit and finds it. `X.Y.Z` already names that
image, so it is left alone. `X.Y` only moves when the release is the newest
patch of that minor, so re-running an old release does not pull `X.Y` backwards.

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

**`semantic-release` failed after creating the git tag** (for example, GitHub
refused to create the release). The tag `vX.Y.Z` now exists without its
GitHub release, and a re-run will not create it, because the tag tells
`semantic-release` the version is already out. This needs a person: delete the
tag and re-run, or create the release by hand. Note that a re-run in
this state does give the image its version tags, since a release tag is on the
commit.

**`promote-latest` failed.** `latest` stays on the previous good commit and CI is
red, so nothing is published. Re-run the job. If `main` has moved on in the
meantime the re-run stands down instead of retagging, which is the right
outcome: the newer commit's run promotes its own image.

**An older run of `main` is re-run.** It cannot move `latest`, for the reason
above, and `semantic-release` does not release a commit that `main` has moved
past. One side effect to know about: CI runs on `main` share a concurrency group
that cancels the run in progress, so re-running an older run while the newest
one is still going cancels the newest. That commit is then neither promoted nor
released until its own run is re-run.

## Testing the release tooling

None of this needs a registry, a token or a docker daemon:

```bash
node scripts/gateway-range.mjs --check          # the gateway release line, and that the line in the BFF and the SDK in go.mod match the pins
node scripts/readme-gateway-range.mjs --check   # the README states it
node --test "scripts/**/*.test.mjs"             # release type, the merged-from-next check, notes, release detection, the tip check, retag and image check (against a stand-in docker)

# release.config.cjs, against the semantic-release version publish.yml pins:
npm install --no-package-lock --prefix /tmp/sr semantic-release@25.0.9
node scripts/release/check-release-config.mjs --from /tmp/sr
```

The `release-tooling` job in `ci.yml` runs all four on every pull request,
because the first real run of the release configuration is on `main`, after the
merge.

## What this pipeline does not do

- **It releases from `main` only.** `branches` in `release.config.cjs` names
  nothing else. CI runs on `release/<major>.<minor>` branches, and the Follow
  upstream workflow creates one when `main` is about to leave a gateway minor,
  but nothing here cuts a release from one yet. The dashboard for gateway
  `0.0.116` lives on the `0.2.x` branch, which predates that scheme, has its
  own copy of this workflow and is also released by hand; nothing described on
  this page releases it. (`0.3.0` is not that line: see *Compatibility* in the
  README for why it must not be used.)
- **It does not pick the version for you.** The suggestion is advice.
- **It does not rebuild images for a release.** The version is decided after the
  image exists, so the image's own `org.opencontainers.image.version` label
  names the branch it was built from (`main`), not `X.Y.Z`. The tag is what
  carries the version.
