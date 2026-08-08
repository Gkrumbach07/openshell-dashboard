# ADR 0001: Standalone Repo, Consumed Downstream as an npm Package

**Status:** Accepted  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

The OpenShell Dashboard is a standalone upstream repo: an independent open-source project for anyone running an OpenShell gateway. It lives outside any consuming platform's monorepo (which would lock out the community and couple our release cadence to theirs) and outside NVIDIA/OpenShell (whose Rust toolchain and CI do not fit a web app); the target home is the neutral `ai-openshell` org. The repo has zero imports from any downstream platform.

That structure makes downstream consumption a real question: host platforms embed these pages via module federation. We evaluated three consumption models:

1. **Subtree sync** — a script replays upstream commits into a vendored directory inside the consumer's monorepo; integration code is written alongside the synced tree. Conflict resolution on every sync.
2. **npm package** — upstream publishes to npm, downstream installs as a dependency. Version bumps are explicit. No sync conflicts.
3. **Direct monorepo development** — develop directly inside a consuming platform's monorepo. No upstream/downstream separation.

## Decision

npm package — the standard shared-component-library pattern.

The upstream repo builds a publishable package with:
- `tsconfig.build.json` compiling to `dist/` with `.js` + `.d.ts`
- `tsc-alias` resolving `~/` path aliases in compiled output
- Five barrel exports: `./pages`, `./components`, `./api`, `./types`, `./slots`
- `peerDependencies` for react, PatternFly, react-query, react-router-dom
- CSS files copied to `dist/` alongside compiled JS

A downstream consumer installs it via `file:` protocol (dev) or a published version (production), adds webpack aliases to resolve from source where its build needs to (CSS handling), and writes thin wrapper components around the exported pages.

## Why not subtree

Subtree sync earns its cost only when downstream wrappers must reach into upstream internals (routes, app context, shell components). Our pages are self-contained with props, and the slot system covers injection — wrappers import only from the published barrels. npm is strictly simpler: version bump vs. patch-replay with conflict resolution.

## Why not direct monorepo

The project is a standalone upstream repo for the whole OpenShell ecosystem. Direct monorepo development inside one consumer would lose the community story.

## Consequences

- Need a CI publish pipeline (GitHub Actions → npm). Tracked in issue #11.
- `build:lib` must be run after upstream changes before downstream picks them up (dev workflow).
- `dist/` is in `.gitignore` — not committed.
- Downstream webpack config needs aliases to resolve source (not `dist/`) for CSS handling in dev mode.
