# Releasing

A release is cut by a person, who chooses whether it is a patch, a minor or a
major. Merging to `main` publishes nothing by itself, whatever the pull
request is titled. This page says how to cut one, what happens when you do,
what each artifact ends up saying about the gateways it supports, and what to
do when a step fails.

The one release nobody has to ask for is a merged compat-sweep bump; see
[The one automatic release](#the-one-automatic-release).

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

The compat sweep opens pull requests that raise the newest supported gateway or
move the SDK ([ADR 0006](adrs/0006-compat-links-and-sweep-axes.md)). Their whole
purpose is to change what the next release declares and contains, they are
always a patch, and they are the release most likely to be forgotten. So when
one is merged and CI has passed on `main`, `publish.yml` cuts a patch for it
without being asked.

Which commits qualify is decided from where they came from, never from their
title ([`scripts/release/sweep-bump.mjs`](../scripts/release/sweep-bump.mjs)):

- the commit was merged into `main` from `compat-sweep/gateway` or
  `compat-sweep/sdk` **in this repository**, and
- it changes only what that axis may change. This is the sweep's own one-axis
  guard, run again on the merged commit, so a sweep pull request that someone
  added other changes to is not released automatically.

Anything that fails either test is simply not released; cut it by hand if it
should be. A patch cut this way also carries every other commit merged since
the last release, like any release does.

## The pipeline

```
push to main
   │
   ▼
ci.yml ── build ──► push-manifest ─────────────► image :sha-<7>
   │                     └── image-range   (reads it back: does it declare the range?)
   │
   ├── check-frontend, check-backend, e2e
   ├── compat (every required gateway lane)
   ├── release-tooling
   │
   └── all green, and this commit is still the tip of main
   │                 └──► promote-latest ──────► image :latest  (same digest)
   │
   ▼
publish.yml   started by a person, with a release type   (or: CI passed for a merged sweep bump)
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

The GitHub release and the container image each state the range of OpenShell
gateways the release supports and the Go SDK it was built against (#66,
ADR 0005). The Helm chart states nothing of its own; by default it deploys the
image of the same version. The range is the lowest and the
highest version among the **required** lanes in
[`deploy/ci/gateway-pins.json`](../deploy/ci/gateway-pins.json) at the released
commit. One script derives it, [`scripts/gateway-range.mjs`](../scripts/gateway-range.mjs),
and everything else calls that script:

| Artifact | What it carries | Written by |
|---|---|---|
| GitHub release | a *Supported OpenShell gateways* section, which also calls out a range that changed since the previous release | `generateNotes` in `scripts/release/gateway-range-plugin.mjs` |
| Container image | env `GATEWAY_SUPPORTED_MIN` / `GATEWAY_SUPPORTED_MAX`, and labels `io.github.gkrumbach07.openshell-dashboard.gateway.min`, `.gateway.max`, `.sdk` | build args in `ci.yml`'s `build` job, consumed by `deploy/Dockerfile`; `image-range` reads the pushed image back and fails if they are missing |
| README | the table under *Compatibility* | `scripts/readme-gateway-range.mjs --write`, run by whatever moves the pins (the compat sweep's pull requests do it themselves) and checked in CI |

The only thing that has to agree with the pins file is `backend/go.mod`: the
`sdk` field must equal the SDK version there, and
`node scripts/gateway-range.mjs --check` fails when it does not. The SDK and the
gateway lanes are otherwise independent and move in separate pull requests
([ADR 0006](adrs/0006-compat-links-and-sweep-axes.md)).

**Releases up to and including `1.1.1` have none of this.** They were cut by
the previous pipeline: no *Supported OpenShell gateways* section,
no range on the image, and no `X.Y.Z` or `X.Y` image tag. Nothing here
adds them after the fact. The first release cut by this pipeline is the first
one that carries them.

The version number does not describe the gateway a deployment needs. A release
that moves the range can break a running installation while looking like a
patch, which is why the release notes say so explicitly when it happens.

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
node scripts/gateway-range.mjs --check          # the range, and that its SDK is the one in go.mod
node scripts/readme-gateway-range.mjs --check   # the README states it
node --test "scripts/**/*.test.mjs"             # release type, the sweep-bump check, notes, release detection, the tip check, retag and image check (against a stand-in docker)

# release.config.cjs, against the semantic-release version publish.yml pins:
npm install --no-package-lock --prefix /tmp/sr semantic-release@25.0.9
node scripts/release/check-release-config.mjs --from /tmp/sr
```

The `release-tooling` job in `ci.yml` runs all four on every pull request,
because the first real run of the release configuration is on `main`, after the
merge.

## What this pipeline does not do

- **It releases from `main` only.** `branches` in `release.config.cjs` names
  nothing else. The dashboard for gateway `0.0.116` lives on the `0.2.x`
  branch, which has its own copy of this workflow and is also released by
  hand; nothing described on this page releases it. (`0.3.0` is not that line:
  see *Compatibility* in the README for why it must not be used.)
- **It does not pick the version for you.** The suggestion is advice.
- **It does not rebuild images for a release.** The version is decided after the
  image exists, so the image's own `org.opencontainers.image.version` label
  names the branch it was built from (`main`), not `X.Y.Z`. The tag is what
  carries the version.
