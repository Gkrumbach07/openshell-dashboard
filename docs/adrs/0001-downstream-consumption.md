# ADR 0001: Downstream Consumption — npm Package and the Extension Surface

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The dashboard runs standalone, and host platforms also embed its pages inside
their own UIs. That second use is a contract question twice over: **how does
the code get to a consumer**, and **what exactly may a consumer rely on**?

Left implicit, both questions were being answered by accident: the published
package was broken (co-located CSS never reached `dist`), the root `types`
field pointed at the wrong barrel, all nine peerDependencies were duplicated
as regular dependencies (double-React risk), one slot and two feature flags
were defined but consumed nowhere, two slots silently vanished in table view,
and auth calls bypassed the configurable base path that exists specifically
for consumers. Two open PRs (#25, #28) resolved the CSS problem in opposite
directions.

## Decision 1: delivery is an npm package

We evaluated three consumption models:

1. **Subtree sync** — a script replays upstream commits into a vendored
   directory inside the consumer's monorepo; integration code is written
   alongside the synced tree. Conflict resolution on every sync.
2. **npm package** — upstream publishes to npm, downstream installs as a
   dependency. Version bumps are explicit. No sync conflicts.
3. **Direct monorepo development** — develop inside a consuming platform's
   monorepo. No upstream/downstream separation, and no standalone project.

**npm.** Subtree sync earns its cost only when downstream wrappers must
reach into upstream internals (routes, app context, shell components). Our
pages are self-contained with props and the slot system covers injection —
wrappers import only from the published barrels, so npm is strictly simpler:
version bump vs. patch-replay with conflict resolution.

Mechanics: `build:lib` compiles `src/` to `dist/` (JS + `.d.ts`), the
package publishes `dist` only, and consumers install via `file:` (dev) or a
published version (production). This repo imports nothing from any
downstream platform — the dependency arrow points one way.

## Decision 2: the extension surface is exactly five mechanisms

They are the contract; everything else is internal and may change without
notice.

### 1. npm barrels — what you can import

`./pages`, `./components`, `./api`, `./types`, `./slots`, plus a root `"."`
export aliasing `./pages`.

- Everything a page composes that a consumer might reasonably wrap or reuse
  is exported from a barrel; "reachable from a page but not exported" is a
  bug (current gaps: `InferenceTab`, `ConnectCard`, the sandbox tab
  components, `AlertProvider` discoverability — proposed issue).
- `peerDependencies` (React, PatternFly, react-query, react-router-dom) are
  **not** duplicated in `dependencies`. The consumer owns the React tree.
- The package builds as proper ESM with a correct root export and `types`
  resolution. `build:lib` runs in CI so publishability cannot silently break.

### 2. Slots — injected UI

`SlotProvider` with named slots; an explicit prop overrides the context slot
at every consumption site. The roster is part of the contract:

| Slot | Status |
|------|--------|
| `credentialInput` | active (provider forms) |
| `modelPicker` | active (inference config) |
| `sandboxMetadata` | active — must render in **both** card and table views (currently card-only: bug) |
| `sandboxActions` | active — same both-views requirement |

Adding a slot is a minor version; removing or changing a signature is major.
A slot nobody consumes is deleted (`workspaceBinding` was, in PR #29) —
dead contract doesn't ship.

### 3. Self-contained pages with navigation callbacks — routing stays the host's

Every page under `src/pages/` is importable and wrappable:

- Takes explicit props (`workspace`, `sandboxName`, …) and uses internal
  `src/api/` hooks for data — no external context assumptions beyond React
  Query's `QueryClientProvider` (and `AlertProvider` where alerts are used)
- No breadcrumbs, no app-shell chrome — the standalone shell adds its own,
  a host adds its own
- Navigation via optional `onSelect` / `onViewSandbox` / `onTabChange`
  callbacks with router-hook fallbacks. Optional-with-fallback (rather than
  required) means pages work out of the box standalone and are overridable
  when embedded.

Contract tightening: **every** page that navigates or has tabs exposes the
callback (WorkspaceDetailPage currently swallows `onViewSandbox` and hides
its tab state — bug), and callback-vs-fallback behavior must be identical in
card and table views. Pages require a Router context for the fallback hooks.

### 4. Feature flags — capability negotiation

Served by the BFF (`/auth/config`), read via `useFeatureFlags()`. Flags
exist for exactly one reason: a deployment's transport or platform cannot
support a feature (`FEATURE_TERMINAL` for WebSocket-incapable transports,
`FEATURE_FILE_TRANSFER`, …). Not A/B switches, not license gates. A flag
nobody reads is deleted (two were, in PR #29; the roster: terminal,
fileTransfer, settings, globalPolicy, credentialRefresh, services,
draftPolicy).

### 5. Runtime configuration — one seam, used everywhere

`setApiBasePath()` and `setSessionExpiredHandler()` from `./api`. **Every**
HTTP call in the package goes through the configured client — a bypass is a
bug, not an exception.

### CSS policy: none

Components ship **zero co-located CSS files**. Styling is PatternFly 6
components, utility classes, and design tokens. (This resolves the
PR #25/#28 conflict in favor of deletion; the two CSS files broke theming
under federation and were the only reason `dist` was unpublishable.)
Third-party CSS a component genuinely requires (`@xterm/xterm/css/xterm.css`
in the terminal) is documented in the README as a consumer bundler
requirement — the exception that proves we own no CSS ourselves.

## Why a closed surface

Federation hosts, npm consumers, and the standalone app must all get
identical behavior from identical inputs. Every ad-hoc integration point
("just read this global," "just this one extra CSS file") forks that
guarantee. Five mechanisms are enough to build a full host-platform
integration (proven in practice); anything they can't express is a
conversation about extending this contract, not a workaround.

## Consequences

- package.json fixes (root export, types field, peer-dep dedup, ESM
  correctness) and CI `build:lib` are a proposed issue — they block any
  real npm publish (#11).
- Slot both-views parity and the WorkspaceDetailPage contract holes are
  proposed issues.
- The stale `FEATURE_FLAGS.md` and one-sentence README consumer section get
  rewritten against this ADR.
- Downstream consumers wrap these five mechanisms and nothing else. Deeper
  coupling (shared navigation, cross-app state) lands here first as a
  contract change.
