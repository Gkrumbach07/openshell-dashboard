# ADR 0008: The npm Package Is Retired

**Status:** Accepted
**Date:** 2026-10-09
**Authors:** Gage Krumbach
**Amends:** [ADR 0001](0001-downstream-consumption.md), decision 1; [ADR 0004](0004-downstream-consumption-i18n.md)

## Context

[ADR 0001](0001-downstream-consumption.md) decided that a host platform gets
the dashboard's pages by installing an npm package, `openshell-dashboard`, and
[ADR 0004](0004-downstream-consumption-i18n.md) added an i18n barrel to it.
The package existed so that a host could embed the pages in its own UI.

It has no consumer. The host platform it was built for, Red Hat OpenShift AI,
decided for its 3.6 release to ship the dashboard as a standalone application:
the container image, deployed next to each gateway with the Helm chart in this
repository. It embeds no pages and imports nothing from the package. No other
consumer is known.

Keeping it publishable was not free:

- Every pull request compiled the library (`build:lib`) and installed the
  packed tarball into a scratch application (`verify:consumer`), to prove the
  package could still be published.
- Every release did the same again and then published, through npm trusted
  publishing. That is bound to the workflow's file name, which is why
  `publish.yml` could not be renamed.
- `frontend/package.json` listed what the application needs to run (React,
  PatternFly, react-query, the router) as `peerDependencies`, so that a
  consumer would own the React tree. The standalone application got them only
  because npm installs peer dependencies by default.
- npm never lets a published version be reused, so each release left a
  permanent entry for a package without a consumer.

## Decision

1. **The npm package is retired.** `main` builds no library and a release
   publishes nothing to npm. The dashboard ships as a container image and a
   Helm chart. A release is a git tag, a GitHub release, the image tags and
   the chart ([docs/releasing.md](../releasing.md)).

2. **What is removed.**

   - The library build and its checks: the `build:lib`, `verify:lib` and
     `verify:consumer` scripts, `frontend/scripts/`,
     `frontend/tsconfig.build.json`, and the CI and release steps that ran
     them.
   - The packaging fields in `frontend/package.json`: `main`, `module`,
     `types`, `exports`, `files` and `publishConfig`. The package is marked
     `private`, so `npm publish` refuses it.
   - `peerDependencies`. They are ordinary `dependencies` now: with no
     consumer to own the React tree, they are what the application needs to
     run.
   - From the release: the `@semantic-release/npm` plugin, the npm trusted
     publishing setup in `publish.yml`, and the `openshell` field that was
     written into the published `package.json`
     (`scripts/release/stamp-package.mjs`).

3. **What stays.** Everything else in ADR 0001 and ADR 0004, as how the
   frontend is organised and no longer as a published contract:

   - the barrels (`pages`, `components`, `api`, `types`, `slots`, `i18n`)
   - slots, self-contained pages with navigation callbacks, feature flags and
     runtime configuration (`setApiBasePath`, `setSessionExpiredHandler`)
   - the i18n facade rule, the English catalogs and the `I18nProvider`
     override path
   - the CSS policy, and zero imports from any downstream platform

4. **How a release is cut does not change.**
   [ADR 0007](0007-releases-are-cut-by-hand.md) stands: `publish.yml` is
   started by hand with a chosen type, and a dry run is the default. The
   version still comes from the git tags.

5. **What is already published is left alone.** The versions on npm (`0.1.0`
   to `1.2.0` on the date above) stay there. Nothing is unpublished, and
   deprecating the package on npmjs.com is a separate step that this ADR does
   not take. No git tag or GitHub release is touched, and the next release
   continues from the last tag.

## Consequences

**A host platform can no longer install the pages.** Embedding the dashboard
in another UI has no delivery path. If that need returns, how the code gets to
the host is a new decision; ADR 0001 lists the options that were weighed the
first time. The pages themselves would not need redesigning, because decision
3 keeps them self-contained.

**Three barrels have no importer.** Application code imports `pages`,
`components` and `api` from their source modules, and the barrels were read
only by the package's consumers. They are still type-checked with the rest of
`src/`. Nothing checks that they are complete, which was also true before.

**CI and the release job do less.** `check-frontend` no longer compiles a
library or installs a packed tarball, and the release job no longer installs
the frontend at all.

**Nothing ties `publish.yml` to its file name.** The workflow is now shown as
*Release*. The file is not renamed here.

**The `0.2.x` branch is not changed by this.** It carries its own copy of the
workflow and of `frontend/package.json`, and that copy still publishes to npm,
under the dist-tag `release-0.2.x`. Until the same removal is made there, a
0.2.x release adds a version to npm.

## What this replaces in ADR 0001 and ADR 0004

In ADR 0001:

- **Decision 1, "delivery is an npm package",** is withdrawn, together with
  its mechanics (`build:lib`, publishing `dist`, installing by `file:` or by
  version).
- **Mechanism 1, "npm barrels".** The barrels stay. They no longer describe
  something a consumer can install, the rule that `peerDependencies` are not
  duplicated in `dependencies` is withdrawn, and `build:lib` no longer runs.
- **The consequence "CI enforces publishability via `build:lib` on every PR"**
  is withdrawn.
- Mechanisms 2 to 5, the CSS policy and the reasons for a closed surface
  stand.

In ADR 0004:

- The barrel is no longer published as `openshell-dashboard/i18n`.
- **Dependencies.** `i18next` and `react-i18next` are plain `dependencies`;
  their `peerDependencies` entries are gone.
- **Build.** Withdrawn with `build:lib` and `scripts/verify-lib-build.mjs`.
- The facade rule, the English-only catalogs and the host override path
  stand.

ADRs 0005 to 0007 mention the npm package as one of the things a release
produced. Their decisions do not depend on it and are unchanged. One sentence
is left without an object: ADR 0007 says that undoing 1.x "waits for the
package rename in #78". There is no package to rename now, and what happens to
the version numbers is not decided here.
