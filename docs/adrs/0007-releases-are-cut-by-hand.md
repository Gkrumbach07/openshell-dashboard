# ADR 0007: Releases Are Cut by Hand, With a Chosen Type

**Status:** Accepted
**Date:** 2026-10-05
**Authors:** Gage Krumbach
**Amends:** [ADR 0006](0006-compat-links-and-sweep-axes.md), decision 9

## Context

Since the npm publish pipeline was added, `semantic-release` ran after every
green CI run on `main`, read the commit titles since the last release, and
published whatever they called for. With squash merges the pull request title
is the commit title, so choosing a title was the same act as publishing.

That produced releases nobody decided on:

- `1.0.0` was published by one `BREAKING CHANGE:` footer in the SDK resync
  (#64). Nobody meant it as a milestone, and a dashboard at 1.x for a gateway
  at 0.1.x misstates its maturity (#78).
- `1.0.1`, `1.0.2`, `1.0.3` and `1.1.0` were each published by a `fix(ci)` or
  `feat(ci)` commit that changed nothing in the package.

Rules were added so that `ci` commits never release (#80). That closed one
hole. The underlying problem stayed: anyone who can merge can publish to npm,
and decides the version, by how they word a title. npm never lets a published
version be reused, so each such mistake is permanent.

## Decision

1. **A release is cut by a person.** `publish.yml` is started by hand on
   `main`. Merging a pull request publishes nothing, whatever its title says.

2. **The person chooses the type.** Patch, minor or major is an input to the
   workflow, with no default: the first option is not a release type, so a run
   fails until one is picked. `scripts/release/release-type-plugin.mjs`
   replaces semantic-release's commit analyzer; it releases the type it is
   given and refuses to run without one.

3. **A dry run is the default.** The workflow shows the version and the notes
   and publishes nothing unless the dry-run box is cleared.

4. **Commit titles advise; they do not decide.** The release notes are still
   written from them, and the run reports the release they would suggest.
   Choosing something smaller than suggested is allowed and gets a warning.

5. **A release needs a green CI run for its commit.** The image a release tags
   is the one that run built.

6. **One release stays automatic: a merged compat-sweep bump.** It is cut as a
   patch once CI has passed on `main`. Its purpose is to change what the next
   release declares (a raised gateway ceiling) or contains (a moved SDK), and
   it is the release most likely to be forgotten.

7. **What counts as a sweep bump is decided by provenance, not by title.** The
   commit must have been merged into `main` from `compat-sweep/gateway` or
   `compat-sweep/sdk` in this repository, and the sweep's one-axis guard must
   pass on the merged commit (`scripts/release/sweep-bump.mjs`). Anything else
   is not released automatically and can be released by hand.

## Consequences

**Version numbers become decisions.** A major can no longer happen because of
a footer. This does not undo 1.x; that waits for the package rename in #78.

**Releases batch.** Everything merged since the last release goes out together
when someone cuts one. A change can sit on `main` unreleased; `latest` still
moves on every green `main`, so there is always a current image.

**Someone has to remember.** That is the cost, and the reason for the one
exception.

**The automatic patch carries everything since the last release,** like any
release. If unreleased feature commits are on `main` when a sweep bump merges,
they ship in that patch. The run summary says how many commits it contains;
cutting releases before merging a sweep bump avoids the surprise.

**A sweep pull request that a person added other changes to is not released
automatically.** The guard refuses it, on purpose.

## What this replaces in ADR 0006

Decision 9 said automated pull requests are `fix:` commits "so merging either
cuts a release". They still are `fix:` commits, and merging one still cuts a
release, but the title is no longer the reason: it only places them under
*Bug Fixes* in the notes. The release is cut because of where the commit came
from (decision 7 above).

## Alternatives considered

**Keep automatic releases, add more rules.** Each rule closes one case. The
decision to publish would still be made by wording.

**A release pull request** (a bot keeps a "release X.Y.Z" pull request open and
merging it releases). Reviewable, but it needs different tooling and still
derives the version from titles unless overridden. A workflow input is the
smaller change and makes the choice explicit.

**No automatic release at all.** Simpler, but a raised ceiling would then reach
versioned artifacts only when someone remembered, and until then a released
dashboard would keep telling users of the new gateway that it is untested.

## Amendments

- [ADR 0009](0009-console-release-policy.md) — replaces decision 2: the release type follows from the gateway's releases (a minor when the gateway starts a minor release line, a patch otherwise) and is not a person's choice. The release workflow still asks for a type until that is built.
