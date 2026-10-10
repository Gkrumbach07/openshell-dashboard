# ADR 0009: Console Release Policy

**Status:** Accepted
**Date:** 2026-10-09
**Authors:** Gage Krumbach
**Amends:** [ADR 0005](0005-gateway-version-compatibility.md), [ADR 0006](0006-compat-links-and-sweep-axes.md), [ADR 0007](0007-releases-are-cut-by-hand.md)

This policy was sent to the OpenShell architecture group for review on
2026-10-09. Changes that come out of that review will be recorded as
amendments.

"The console" is this repository's product. The code and the earlier ADRs call
it the dashboard.

Terms follow OpenShell's
[RFC 0014, Alpha Exit Criteria and Stable Release Policy](https://github.com/NVIDIA/OpenShell/tree/main/rfc/0014-release-stability):
stable release, pre-release, patch and minor release, minor release line,
Stable interface. A minor release line is every release that shares a major
and a minor number; here it is written `0.1` and shown as `0.1.x`.

## Context

[ADR 0005](0005-gateway-version-compatibility.md) decided that a console
release declares a window of gateway versions, and
[ADR 0006](0006-compat-links-and-sweep-axes.md) that the window is derived
from the gateway releases CI tests against. That was built: a minimum and a
maximum, a notice in the UI with four verdicts (unsupported, supported,
untested, unknown), and the same two numbers in the image, the README and the
release notes.

Three things about it did not hold up.

- **The answer had to be looked up.** Whether a console works with a gateway
  depended on that console release's own window, so the question could only be
  answered from a table of releases. The console's version number said nothing:
  console 1.x is for gateway 0.1.x.
- **The window reached the console from outside.** The BFF was told its window
  through two environment variables, which this repository's Dockerfile set
  from build args. An image built any other way had none. A downstream build
  that uses its own Dockerfile and passes no build args produced an image in
  which the notice could never appear.
- **A newer gateway patch release was reported as untested.** Every gateway
  patch release newer than the one the console had last been moved to got a
  notice until the console caught up, although nothing was known to be wrong
  with it.

OpenShell's RFC 0014 proposes a release policy for the gateway in which no
Stable interface breaks within a minor release line. A console can rest on
that rule instead of on a window of its own.

## Decision

1. **The console shares the gateway's minor release line.** Any console 0.1.x
   works with any gateway 0.1.x. The two patch numbers are independent. To know
   whether a console works with a gateway, compare the first two numbers of
   their versions: if they match, the two are compatible. There is no
   compatibility table, no minimum and no maximum.

   Console X.Y.0 means "compatible with gateway X.Y.x". It does not mean every
   gateway feature is in the UI yet; those follow in the console's patch
   releases of that line.

2. **A gateway minor release requires a console minor release.** Console X.Y.0
   starts the matching release line. It is held until the compatibility suite
   passes against gateway X.Y.0, and that gateway line has no compatible
   console in the meantime. A console release never ships with a failing
   compatibility suite. A gateway feature the console cannot support yet is
   left out or marked unsupported, never shipped broken.

3. **On a gateway patch release the console moves to it and releases a
   patch.** Consoles already installed keep working without it. If the
   compatibility suite fails against the new gateway release, the console stays
   on the last one that passed until it is fixed.

4. **The console's own releases are patch releases.** Between gateway releases
   the console publishes patch releases for fixes and new features, including
   critical and security fixes. It never starts a minor on its own: its minor
   moves only when the gateway's does.

5. **The previous release line gets critical and security fixes, from
   `release/<major>.<minor>`.** Once console X.Y.0 is out, the line before it
   is maintained from its release branch for as long as the gateway maintains
   the same line. Nothing else is backported.

6. **Every change is tested against the gateway pinned by the branch it merges
   into.** The end-to-end compatibility suite runs against a real gateway for
   every change, on `main` and on a release branch alike.

7. **New gateway releases are picked up from the gateway's release tags.**
   Nothing has to be handed to this repository. Moving to a gateway release is
   one change: the gateway the branch pins and the SDK at that release's tag
   move together, and the compatibility suite decides whether it lands.

8. **Gateway pre-releases are tested ahead of the stable release**, in two
   ways. The released console runs against the pre-release gateway, and a
   `next` branch built on the pre-release's SDK runs the full tests. A failure
   opens an issue, so a breaking change is found before the stable release and
   not on its release day. New work that needs the upcoming gateway release is
   built on `next`, which merges into `main` when the gateway releases.

9. **The compatibility notice compares release lines.** The console shows a
   notice when it is connected to a gateway outside its minor release line.
   There are three verdicts:

   | Verdict | When |
   |---|---|
   | supported | the gateway's major and minor number are the console's line. That is any patch release of the line, and any pre-release, development build or downstream rebuild of one |
   | unsupported | any other line, older or newer |
   | unknown | the gateway reports no version that can be read, or the console's own line cannot be read |

   The console's line is built into the BFF, so every image knows it, whatever
   built the image and whatever it is started with.

10. **The one requirement on OpenShell releases: no breaking change to a
    Stable interface within a minor release line**, as RFC 0014 proposes. The
    policy rests on this.

## Implemented in steps

This ADR records the whole policy. Not all of it is built. The change that
adds this ADR builds two parts:

- **The notice compares release lines** (decision 9).
  `GET /api/v1/gateway/compatibility` and the `compatibility` object on
  `GET /api/v1/gateway` carry one of the three verdicts and the console's line
  (`supportedLine`) where they carried a minimum and a maximum. `untested` is
  gone.
- **The line is built in.** It is a constant in the BFF's source
  (`BuiltInGatewayReleaseLine` in
  `backend/pkg/models/gateway_release_line.go`), and it is the line of the
  newest required lane in `deploy/ci/gateway-pins.json`. CI fails when the two
  disagree (`node scripts/gateway-range.mjs --check`), and the required compat
  lanes start the BFF with nothing set and require the verdict `supported`.
  `GATEWAY_SUPPORTED_MIN` and `GATEWAY_SUPPORTED_MAX` are removed;
  `GATEWAY_RELEASE_LINE` can replace the built-in line for tests and local
  development. The image label, the README and the release notes state the
  line and the releases it is tested on.

Already in place, from ADRs 0005 to 0007:

- The compatibility suite runs against real gateways on every pull request
  into `main`, which today pins two releases of its line, 0.1.0 and 0.1.3.
- A console release is cut only from a commit whose CI run passed, the
  compatibility suite included.

Not built yet. Until each is, what it would replace keeps working as the ADR
it came from describes:

- **The console's version does not share the gateway's line.** Releases are
  numbered 1.x and are for gateway 0.1.x, so decision 1 cannot yet be read off
  two version numbers; the image label and the release notes state the line
  instead. How the numbering gets there is not decided here. (The npm package
  those numbers were also published under is retired:
  [ADR 0008](0008-retire-the-npm-package.md).)
- **The release type is still chosen by a person** when the release workflow
  is started ([ADR 0007](0007-releases-are-cut-by-hand.md)). Nothing enforces
  decisions 2 to 4.
- **The compat sweep is unchanged.** It still has a gateway axis and an SDK
  axis, opens one pull request per axis, and speaks of a floor and a ceiling
  ([ADR 0006](0006-compat-links-and-sweep-axes.md)). It looks at stable
  releases and at upstream HEAD; it does not test pre-releases.
- **There is no `next` branch and no `release/<major>.<minor>` branch.** The
  dashboard for gateway 0.0.116 lives on the `0.2.x` branch, which predates
  this policy.

## Consequences

**A reader needs two numbers, not a table.** That is the point of the change.
It holds once the console's version shares the gateway's line; until then the
line is stated next to the version.

**The console claims more than it tests.** It is tested against the gateway
releases its branch pins and claims the whole line. The difference is covered
by decision 10 and by nothing in this repository. If a gateway patch release
breaks a Stable interface, consoles already installed break with it, and the
remedy is a fix on one side or the other: the console has no narrower claim to
fall back on.

**A gateway on a newer line is told it is unsupported, where it used to be
told it was untested.** Inside the line the opposite happens: a gateway patch
release newer than the one the console is tested on is supported and shows no
notice.

**A gateway that does not say what it is gets no notice.** An unstamped build
reports `0.0.0`, and the verdict is unknown. This was already so.

**The line is written twice**, in the pins file (as the newest required lane)
and in the BFF's source, and CI holds the two together. The second copy is
what lets an image that was handed nothing know its line. Moving the newest
required lane to a new minor without changing the constant fails CI twice: in
the check above, and in the required compat lane itself, whose gateway the BFF
would then call unsupported.

**The sweep cannot move the console to a new gateway minor on its own.** Its
gateway pull request changes the pins file only, so it fails both checks until
someone changes the constant. That is consistent with decision 2: starting a
new line is a console minor release, not a routine move.

## What this replaces in ADR 0005

- **Decision 1, "declare a window, not a point".** The claim is a minor
  release line. There is no floor and no ceiling in what a release declares.
- **The meaning the notice took from the window.** A gateway older than the
  floor was unsupported and one newer than the ceiling was untested. Now a
  gateway is on the console's line or it is not.
- **"A moved floor is breaking for deployments, even when semver says
  patch."** A console patch release cannot change which gateways the console
  is for. Only a minor release can.
- **Decision 5** still holds for the console's own patch releases, which need
  nothing from the gateway. It no longer holds for the console's minor, which
  moves only with the gateway's.

What stands: never claim `latest`, and the compatibility suite against real
gateways is what decides whether a console may be released.

## What this replaces in ADR 0006

- **Decision 1, in part.** The wire link is still proven by the compatibility
  suite and by nothing else when the question is whether a console may be
  released or moved to a gateway release. What the console claims to its users
  now goes further than what was run: the rest of the line is claimed on the
  strength of decision 10 above, which is an inference from version numbers.
- **Decision 2, "the supported range is the required lanes".** The required
  lanes are the gateway releases a branch is tested against. What the console
  supports is the line of the newest one.
- **Decision 5, the two sweep axes, and decision 6, "an automated PR changes
  exactly one axis".** Moving to a gateway release is one change that moves the
  pinned gateway and the SDK together (decision 7 above). Until the sweep is
  rebuilt it keeps working as ADR 0006 describes.
- **Decisions 3 and 4** stand for `main` and for release branches: only stable
  releases are pinned there. `next` is built on a pre-release by definition
  and is the only branch that pins one.

What stands: which check proves which link, `-count=1` on every compatibility
run, and gateway 0.0.116 being served by the 0.2.x line.

## What this replaces in ADR 0007

- **Decision 2, "the person chooses the type".** The type follows from what
  the release is: the first console release for a new gateway minor release
  line is a minor, and every other release is a patch.

Whether a release is started by a person is not changed by this ADR. What
stands besides: a release is cut from a commit whose CI run passed, and a
merged move to a new gateway patch release is released as a patch.

## Amendments

- **2026-10-09: decisions 6, 7 and 8 are implemented, and the compat sweep is
  retired.** Two of the items "Implemented in steps" lists as not built are
  built now ("The compat sweep is unchanged" and "There is no `next` branch
  and no `release/<major>.<minor>` branch"), and what that section and
  "Consequences" say about lanes and the sweep describes the state before
  this.

  - *One gateway per branch (decision 6).* `deploy/ci/gateway-pins.json` names
    one upstream release: `release`, its gateway and supervisor images by
    digest, and `sdk`. It no longer lists lanes. `ci.yml` runs the
    compatibility suite against that gateway on pushes to `main` and
    `release/**` and on pull requests into `main`, `next` and `release/**`.
    The built-in line is the line of that release. The second release `main`
    used to run, 0.1.0, is no longer run: the rest of the line rests on
    decision 10 alone.
  - *Release pickup (decision 7).* `.github/workflows/follow-upstream.yml`
    reads upstream's tags every hour. Its target is the newest stable release
    above the one `main` pins, or failing that the newest pre-release that
    leads up to one. Several stable releases waiting are not walked through.
    Moving to the target is one commit: the images, the SDK at the tag's
    commit, the built-in line when the minor changes, and the README's
    generated block.
  - *Pre-releases (decision 8).* The same workflow keeps the `next` branch in
    one shape (`main`, that one commit, then people's commits) and keeps its
    pull request into `main` open: a draft while the target is a pre-release,
    ready for review once it is a stable release. It runs check A, the BFF as
    `main` builds it against the target's gateway, and keeps one issue for a
    failure. Check B is CI on the `next` pull request. A CI check of its own,
    `pins a stable release`, keeps a pre-release out of `main` and
    `release/**`, so that a `next` that is not released upstream yet is not
    read as a compatibility failure.
  - *What replaced the sweep.* `compat-sweep.yml`, its gateway axis and SDK
    axis, the `compat-sweep/*` branches and the one-axis guard are removed;
    `deploy/ci/sweep/` became `deploy/ci/upstream/`. Upstream HEAD is no longer
    probed: pre-releases are. The consequence above, "The sweep cannot move the
    console to a new gateway minor on its own", no longer applies, because the
    pin move changes the built-in line in the same commit. A move to a new
    minor still cannot merge until the compatibility suite passes on it.
  - *The automatic release* is the merge of `next`
    (`scripts/release/next-merge.mjs`). It is still cut as a patch.
  - *`release/<major>.<minor>`* is created from `main` by the workflow when the
    target is a stable release on a new minor. It is created, not kept up to
    date, and nothing cuts a release from it yet.

  Still not built: the console's version sharing the gateway's line, and the
  release type following from what the release is (decisions 1 to 4). A move
  to a new gateway minor is therefore still released as a patch, and the
  `next` pull request says so when it applies.

- **2026-10-09: the version of a release is computed (decisions 1 to 5, as
  far as version numbers go).** The two things the amendment above lists as
  still not built are built: the console's version shares the gateway's line,
  and nobody chooses a release type.

  - *The computation.* The line is the major and minor number of the stable
    release the branch pins: `release` in `deploy/ci/gateway-pins.json`, which
    CI holds to the built-in line. The version is `<line>.<n>`, where `n` is
    one more than the highest patch among the release tags `v<line>.*` that
    exist, and `0` when the line has none
    (`scripts/release/next-version.mjs`). Tags on other lines are ignored,
    and so is any tag that is not exactly `vX.Y.Z`. A branch that pins a
    pre-release is not released.
  - *Decision 1.* The first two numbers of a release are its gateway line, so
    whether a console works with a gateway can be read off two version
    numbers.
  - *Decisions 2 and 4.* There is no release type. The first release after
    the pin moves to a new gateway minor is `X.Y.0`, because that line has no
    tag yet, and every other release is the next patch. Nothing a contributor
    writes can start a minor. "Held until the compatibility suite passes" is
    enforced as it was: a release needs a green CI run for its commit.
  - *Decision 3.* The merge of `next` is still released without being asked,
    and its version is computed like any other: the next patch for a move
    within the line, `X.Y.0` for a move to a new minor.
  - *Decision 5.* The release workflow can be started by hand on
    `release/<major>.<minor>`, where the same computation gives that line its
    next patch. Only that line's `X.Y` image tag moves. The branch has to pin
    its own line, and the commit has to contain the newest release of its
    line. Keeping a release branch up to date, and deciding what is
    backported to it, is still a person's work.
  - *How.* `semantic-release` is removed. It numbers a release as the last
    tag plus a chosen kind of bump, and starts a history at `1.0.0`; neither
    is this model. `scripts/release/cut-release.mjs` computes the version,
    writes the notes (the titles of the commits since the previous release,
    then the *Supported OpenShell gateways* section) and creates the GitHub
    release, which creates the tag.
  - *What a running console shows.* No version number: an image is built
    before a release is cut and is only given more tags afterwards. The About
    dialog shows the gateway release line the build is for, and the commit it
    is built from when the build was told.
  - *The releases from before.* The tags `v0.1.3`, `v0.2.0`, `v0.3.0` and
    `v1.0.0` to `v1.2.0` were numbered from commit titles. The computation
    cannot tell them from its own, so `v0.1.3` is counted on the `0.1` line
    for as long as it exists. What can be told is that its commit was not
    built for that line: a dry run says so, and a real run refuses to release
    while it is counted. This change deletes no tag and no release. "A reader needs two numbers, not a table", under
    Consequences, holds for every release cut from here on.

  ADR 0007's own amendment says which of its decisions this replaces.

- **2026-10-10: `v0.1.0` is the first release under this policy, and the
  releases from before it are deleted.** With this, nothing in "Implemented in
  steps" is left unbuilt.

  - *The console's version shares the gateway's line (decision 1).* `v0.1.0`
    was released from `main` at `e80505a`: gateway line `0.1.x`, tested on
    0.1.3, image tags `0.1.0` (written once) and `0.1` (moves with each
    release on the line), Helm chart `0.1.0`. Every numbered release that
    exists follows the policy, so "A reader needs two numbers, not a table",
    under Consequences, holds for all of them.
  - *The releases from before.* The ten releases `v0.1.3`, `v0.2.0`, `v0.3.0`
    and `v1.0.0` to `v1.2.0` were deleted, GitHub releases and git tags both.
    Their numbers had been assigned automatically from commit titles and said
    nothing about a gateway. The amendment above says "This change deletes no
    tag and no release"; this one does. The tag names are free, and later
    releases use them again at other commits: the fourth release on the `0.1`
    line will be `v0.1.3`, and `v0.2.0` comes when the gateway reaches 0.2.
    The refusal that amendment describes stays in `cut-release.mjs`, for a
    tag pushed by hand or pushed back from a clone that still has an old one.
  - *Gateway 0.0.116.* It is served by one release, named `gateway-0.0.116`:
    a GitHub release and a git tag of that name on commit `906960b`, the tip
    of the `0.2.x` branch, and the image tag `gateway-0.0.116`. It is outside
    the version numbering on purpose: gateway 0.0.x releases were not
    compatible with each other, so a console version `0.0.x` would claim too
    much. It is for gateway 0.0.116 only, and no further release is planned
    for it. The `0.2.x` branch is deleted; the tag keeps its commit. This
    replaces "gateway 0.0.116 being served by the 0.2.x line", under "What
    this replaces in ADR 0006", and the sentence about the `0.2.x` branch
    under "Not built yet".
  - *What "Implemented in steps" leaves unbuilt: nothing.* Of its four "Not
    built yet" items, the first amendment replaced the sweep and built the
    workflow that keeps `next` and creates `release/<major>.<minor>`, and the
    second made the version computed and removed the release type. Built is
    not the same as used. When `v0.1.0` was released, the Follow upstream
    workflow had not run yet, so no `next` branch and no
    `release/<major>.<minor>` branch existed; `v0.1.0` was started by hand,
    and neither the automatic release of a merged `next` nor a release from a
    release branch had run outside the tests. Keeping a release branch up to
    date, and deciding what is backported to it, is still a person's work.

## References

- [RFC 0014](https://github.com/NVIDIA/OpenShell/tree/main/rfc/0014-release-stability) — OpenShell's proposed release and stability policy, whose terms and whose rule on Stable interfaces this ADR uses
- [ADR 0005](0005-gateway-version-compatibility.md), [ADR 0006](0006-compat-links-and-sweep-axes.md), [ADR 0007](0007-releases-are-cut-by-hand.md) — the decisions this amends
- [ADR 0008](0008-retire-the-npm-package.md) — the dashboard ships as a container image and a Helm chart
- `backend/pkg/models/compatibility.go` and `gateway_release_line.go` — the verdict and the built-in line
- `scripts/gateway-range.mjs` — derives the line from the pins and holds the built-in line to them
- `.claude/rules/openshell-api.md` hard facts 18 and 20
