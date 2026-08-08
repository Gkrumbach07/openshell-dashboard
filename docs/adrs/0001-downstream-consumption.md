# ADR 0001: Downstream Consumption — npm Package and the Extension Surface

**Status:** Accepted
**Date:** 2026-08-07
**Authors:** Gage Krumbach

## Context

The dashboard runs standalone, and host platforms also embed its pages inside
their own UIs. That second use is a contract question twice over: **how does
the code get to a consumer**, and **what exactly may a consumer rely on**?

## Decision 1: delivery is an npm package

We evaluated three consumption models:

1. **Subtree sync** — a script replays upstream commits into a vendored
   directory inside the consumer's monorepo. Conflict resolution on every sync.
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
  is exported from a barrel.
- `peerDependencies` (React, PatternFly, react-query, react-router-dom) are
  **not** duplicated in `dependencies`. The consumer owns the React tree.
- `build:lib` runs in CI so publishability cannot silently break.

### 2. Slots — injected UI

`SlotProvider` with named slots; an explicit prop overrides the context slot
at every consumption site. The roster is part of the contract:

| Slot | Purpose |
|------|---------|
| `credentialInput` | provider forms |
| `modelPicker` | inference config |
| `sandboxMetadata` | sandbox card / table row |
| `sandboxActions` | sandbox card / table row |

Adding a slot is a minor version; removing or changing a signature is major.
Unused slots are deleted — dead contract doesn't ship.

### 3. Self-contained pages with navigation callbacks

Every page under `src/pages/` is importable and wrappable:

- Takes explicit props (`workspace`, `sandboxName`, …) and uses internal
  `src/api/` hooks for data — no external context assumptions beyond React
  Query's `QueryClientProvider`
- No breadcrumbs, no app-shell chrome — the standalone shell adds its own,
  a host adds its own
- Navigation via optional `onSelect` / `onViewSandbox` / `onTabChange`
  callbacks with router-hook fallbacks. Optional-with-fallback means pages
  work out of the box standalone and are overridable when embedded.

Pages require a Router context for the fallback hooks.

### 4. Feature flags — capability negotiation

Served by the BFF (`/auth/config`), read via `useFeatureFlags()`. Flags
exist for exactly one reason: a deployment's transport or platform cannot
support a feature (`FEATURE_TERMINAL` for WebSocket-incapable transports,
`FEATURE_FILE_TRANSFER`, …). Not A/B switches, not license gates. A flag
nobody reads is deleted.

### 5. Runtime configuration — one seam, used everywhere

`setApiBasePath()` and `setSessionExpiredHandler()` from `./api`. **Every**
HTTP call in the package goes through the configured client — a bypass is a
bug, not an exception.

### CSS policy: minimal

Co-located CSS is kept to a minimum — only layout rules with no PatternFly
utility equivalent (e.g. `flex: 1`, `min-width: 0`). All values use
PatternFly design tokens. Third-party CSS a component genuinely requires
(`@xterm/xterm/css/xterm.css` in the terminal) is documented in the README
as a consumer bundler requirement.

## Why a closed surface

Federation hosts, npm consumers, and the standalone app must all get
identical behavior from identical inputs. Every ad-hoc integration point
forks that guarantee. Five mechanisms are enough to build a full
host-platform integration; anything they can't express is a conversation
about extending this contract, not a workaround.

## Consequences

- Downstream consumers wrap these five mechanisms and nothing else. Deeper
  coupling (shared navigation, cross-app state) lands here first as a
  contract change.
- CI enforces publishability via `build:lib` on every PR.
