# ADR 0012: The Extension Surface

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

ADR 0002 chose npm as the consumption model and ADR 0004 made pages
self-contained. Neither defines the *complete* contract a downstream consumer
can rely on, and the gaps are showing: the published package is currently
broken (co-located CSS never reaches `dist`), the root `types` field points at
the wrong barrel, all nine peerDependencies are duplicated as regular
dependencies (double-React risk), one slot and two feature flags are defined
but consumed nowhere, two slots silently vanish in table view, and the auth
API calls bypass the configurable base path that exists specifically for
downstream consumers. Two open PRs (#25, #28) resolve the CSS problem in
opposite directions.

## Decision

The extension surface is **exactly five mechanisms**. They are the contract;
everything else is internal and may change without notice.

### 1. npm barrels — what you can import

`./pages`, `./components`, `./api`, `./types`, `./slots`. Plus a root `"."`
export aliasing `./pages`. Rules:

- Everything a page composes that a consumer might reasonably wrap or reuse
  is exported from a barrel; "reachable from a page but not exported" is a
  bug (current gaps: `InferenceTab`, `ConnectCard`, the sandbox tab
  components, `AlertProvider` discoverability — proposed issue).
- `peerDependencies` (React, PF6, react-query, react-router-dom) are **not**
  duplicated in `dependencies`. The consumer owns the React tree.
- The package builds as proper ESM with a correct root export and `types`
  resolution. `build:lib` runs in CI so publishability cannot silently break.

### 2. Slots — injected UI

`SlotProvider` with named slots; explicit prop overrides context slot at every
consumption site. The slot roster is part of the contract:

| Slot | Status |
|------|--------|
| `credentialInput` | active (provider forms) |
| `modelPicker` | active (inference config) |
| `sandboxMetadata` | active — must render in **both** card and table views (currently card-only: bug) |
| `sandboxActions` | active — same both-views requirement |
| `workspaceBinding` | **removed** (PR #29) — was defined but never consumed; dead contract doesn't ship |

Adding a slot is a minor version; removing or changing a signature is major.

### 3. Navigation callbacks — routing stays the host's

Optional `onSelect` / `onViewSandbox` / `onTabChange` props with router-hook
fallbacks (ADR 0004). Contract tightening: **every** page that navigates or
has tabs exposes the callback (WorkspaceDetailPage currently swallows
`onViewSandbox` and hides its tab state — bug), and callback-vs-fallback
behavior must be identical in card and table views.

### 4. Feature flags — capability negotiation

Served by the BFF (`/auth/config`), read via `useFeatureFlags()`. Flags exist
for exactly one reason: a deployment's transport or platform cannot support a
feature (`FEATURE_TERMINAL` per ADR 0008, `FEATURE_FILE_TRANSFER`, …). Flags
are not A/B switches and not license gates. A flag nobody reads is deleted
(`workspaceBinding`, `resourceLinks` — removed in PR #29; the roster is now
terminal, fileTransfer, settings, globalPolicy, credentialRefresh, services,
draftPolicy).

### 5. Runtime configuration — one seam, used everywhere

`setApiBasePath()` and `setSessionExpiredHandler()` from `./api`. **Every**
HTTP call in the package goes through the configured client — the current
auth-path bypasses (`auth.ts`, `oidc.ts`, `AuthCallbackPage`, `logout.ts`
calling bare `/api/v1/...`) break any consumer that sets a base path and are
bugs, not exceptions.

### CSS policy: none

Components ship **zero co-located CSS files**. Styling is PatternFly 6
components, utility classes, and design tokens inline. This resolves the
PR #25 / PR #28 conflict in favor of deletion (#25's approach): the two CSS
files broke PF theming under federation and are the only reason `dist` is
unpublishable. PR #28's copy machinery is not merged; issue #26 closes as
overtaken. Third-party CSS that a component genuinely requires
(`@xterm/xterm/css/xterm.css` in the terminal) is documented in the README as
a consumer bundler requirement — it is the exception that proves we don't
own any CSS ourselves.

## Why a closed surface

Model federation hosts, npm consumers, and the standalone app must all get
identical behavior from identical inputs. Every ad-hoc integration point
("just read this global," "just this one extra CSS file") is a fork in that
guarantee. Five mechanisms is enough to build the odh-dashboard integration
today (proven on the `openshell-npm-integration` branch); anything they can't
express is a conversation about extending the contract, not a workaround.

## Consequences

- package.json fixes (root export, types field, peer-dep dedup, ESM
  correctness) and CI `build:lib` are a proposed issue — they block any real
  npm publish (#11).
- Slot both-views parity and the WorkspaceDetailPage contract holes are
  proposed issues.
- The stale `FEATURE_FLAGS.md` and one-sentence README consumer docs get
  rewritten against this ADR.
- Downstream (RHOAI) wraps these five mechanisms and nothing else. If the
  Aug 7 topology discussions later demand deeper integration (shared
  navigation, cross-app state), that lands here first as a contract change.
