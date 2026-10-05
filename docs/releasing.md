# Releasing

Nobody cuts a release by hand. Merging to `main` is the whole procedure; this
page describes what happens next, what each artifact ends up saying about the
gateways it supports, and what to do when a step fails.

## One version, three artifacts

A release `vX.Y.Z` is:

| Artifact | Where | Made by |
|---|---|---|
| npm package `openshell-dashboard@X.Y.Z` (frontend only) | npmjs.com | `semantic-release`, in `publish.yml` |
| GitHub release `vX.Y.Z` | this repository | `semantic-release`, in `publish.yml` |
| Container image tags `X.Y.Z` and `X.Y` | `quay.io/gkrumbach07/openshell-dashboard` | `publish.yml`, by retagging the image CI already built |

The BFF and the UI ship together, so they share the version.

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
   ▼  CI concluded "success"
publish.yml ── semantic-release ───────────────► git tag vX.Y.Z
   │                                             npm openshell-dashboard@X.Y.Z
   │                                             GitHub release vX.Y.Z
   │
   └── a vX.Y.Z tag is on this commit ──► tag-image ──► image :X.Y.Z, :X.Y  (same digest)
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
- **`publish.yml` runs by itself only after CI succeeds on `main`.** A red
  `main` cuts no release and does not move `latest`.

## What cuts a release

The commits since the last release, read by the rules in
[`release.config.cjs`](../release.config.cjs). The table is in
[CONTRIBUTING.md](../CONTRIBUTING.md#the-commit-type-decides-whether-a-merge-cuts-a-release).
In short: `fix` and `perf` are a patch, `feat` is a minor, `!` or a
`BREAKING CHANGE:` footer is a major, and nothing whose type or scope is `ci`
ever releases.

When no commit calls for a release, `publish.yml` succeeds and does nothing.

## What every release declares

Each artifact states the range of OpenShell gateways the release supports and
the Go SDK it was built against (#66, ADR 0005). The range is the lowest and the
highest version among the **required** lanes in
[`deploy/ci/gateway-pins.json`](../deploy/ci/gateway-pins.json) at the released
commit. One script derives it, [`scripts/gateway-range.mjs`](../scripts/gateway-range.mjs),
and everything else calls that script:

| Artifact | What it carries | Written by |
|---|---|---|
| GitHub release | a *Supported OpenShell gateways* section, which also calls out a range that changed since the previous release | `generateNotes` in `scripts/release/gateway-range-plugin.mjs` |
| npm package | `"openshell": { "gateway": ">=A <=B", "sdk": "…" }` in `package.json` | `prepare` in the same plugin, via `scripts/release/stamp-package.mjs` |
| Container image | env `GATEWAY_SUPPORTED_MIN` / `GATEWAY_SUPPORTED_MAX`, and labels `io.github.gkrumbach07.openshell-dashboard.gateway.min`, `.gateway.max`, `.sdk` | build args in `ci.yml`'s `build` job, consumed by `deploy/Dockerfile`; `image-range` reads the pushed image back and fails if they are missing |
| README | the table under *Compatibility* | `scripts/readme-gateway-range.mjs --write`, checked in CI |

The committed `frontend/package.json` has no `openshell` field, for the same
reason its version is `0.0.0-semantically-released`: the value is stamped into
the CI checkout just before `npm publish` and never committed, so there is no
second copy to drift.

Our semver describes the npm API, not the gateway a deployment needs. A release
that moves the range can break a running installation while looking like a
patch, which is why the release notes say so explicitly when it happens.

## Running it by hand

`publish.yml` can be dispatched manually from `main` (**Actions → Publish to npm
→ Run workflow**). It releases the commit `main` points at, exactly as the
automatic run would. Two things to know:

- It does not wait for CI. If CI has not finished building that commit there is
  no `sha-<7>` image yet, and the `tag-image` job fails saying so.
- It is safe to run when there is nothing to release.

## When something fails

**`tag-image` failed, the release itself went out.** Use *Re-run failed jobs* on
that run. The job only needs the registry, and it is repeatable: it finds the
`vX.Y.Z` tag on the commit and points the image tags at the same digest again.

**The whole publish workflow is re-run after a release was cut.**
`semantic-release` finds nothing new and does nothing. The image step still
looks for a release tag on the commit and finds it. `X.Y.Z` already names that
image, so it is left alone. `X.Y` only moves when the release is the newest
patch of that minor, so re-running an old release does not pull `X.Y` backwards.

**`tag-image` says `X.Y.Z` already names another digest.** The commit was built
again after it was released. *Re-run all jobs* on a released commit's CI run
does that: the second build has a new digest, because its labels carry the build
time, and `sha-<7>` now points at it. The release is not allowed to follow.
`X.Y.Z` still names the image that was released, nothing was pushed, and there
is nothing to repair. To retry a failed job of an old run, use *Re-run failed
jobs*, which leaves a build that passed alone.

**`tag-image` says it could not tell whether `X.Y.Z` exists.** The registry
answered the lookup with something other than "here it is" or "no such tag", so
the write-once check could not be made and nothing was pushed. Re-run the job.

**`semantic-release` failed after creating the git tag** (for example, npm
rejected the publish). The tag `vX.Y.Z` now exists without its npm package or
GitHub release, and a re-run will not publish them, because the tag tells
`semantic-release` the version is already out. This needs a person: delete the
tag and re-run, or publish the missing pieces by hand. Note that a re-run in
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
node --test "scripts/**/*.test.mjs"             # notes, stamp, release detection, the tip check, retag and image check (against a stand-in docker)

# release.config.cjs, against the semantic-release version publish.yml pins:
npm install --no-package-lock --prefix /tmp/sr semantic-release@25.0.9
node scripts/release/check-release-config.mjs --from /tmp/sr
```

The `release-tooling` job in `ci.yml` runs all four on every pull request,
because the first real run of the release configuration is on `main`, after the
merge.

To see what the published package would contain:

```bash
node scripts/release/stamp-package.mjs            # adds "openshell" to frontend/package.json
(cd frontend && npm pack --silent --pack-destination /tmp)
tar -xOzf /tmp/openshell-dashboard-0.0.0-semantically-released.tgz package/package.json | jq .openshell
git checkout -- frontend/package.json             # the stamp is never committed
```

## What this pipeline does not do

- **It releases from `main` only.** The 0.x maintenance line (last release
  `v0.3.0`, the one that works with gateway `0.0.116`) has no release branch.
  Cutting a `0.3.1` would need a maintenance branch added to `branches` in
  `release.config.cjs`.
- **It does not rebuild images for a release.** The version is decided after the
  image exists, so the image's own `org.opencontainers.image.version` label
  names the branch it was built from (`main`), not `X.Y.Z`. The tag is what
  carries the version.
