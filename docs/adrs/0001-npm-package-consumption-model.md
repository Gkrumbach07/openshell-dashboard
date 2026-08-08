# ADR 0001: Standalone Repo, Consumed Downstream as an npm Package

**Status:** Accepted  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

The OpenShell Dashboard is a standalone upstream repo: an independent open-source project for anyone running an OpenShell gateway, not an RHOAI feature. It lives outside odh-dashboard (which would lock out the community and couple release cadence to RHOAI) and outside NVIDIA/OpenShell (whose Rust toolchain and CI do not fit a web app); the target home is the neutral `ai-openshell` org. The repo has zero `@odh-dashboard/*` imports.

That structure makes downstream consumption a real question: odh-dashboard (RHOAI) must consume this repo via module federation. We evaluated three consumption models:

1. **Subtree sync** (model-registry pattern) — `package-subtree.sh` replays upstream commits into `packages/*/upstream/`, midstream writes `odh/` integration code inside the synced directory. Conflict resolution on every sync.
2. **npm package** (mod-arch-core pattern) — upstream publishes to npm, downstream installs as a dependency. Version bumps are explicit. No sync conflicts.
3. **Direct monorepo development** (agent-ops pattern) — develop directly in `packages/agent-ops/` in odh-dashboard. No upstream/downstream separation.

## Decision

npm package, following the `mod-arch-core` precedent (`opendatahub-io/mod-arch-library`).

The upstream repo builds a publishable package with:
- `tsconfig.build.json` compiling to `dist/` with `.js` + `.d.ts`
- `tsc-alias` resolving `~/` path aliases in compiled output
- Five barrel exports: `./pages`, `./components`, `./api`, `./types`, `./slots`
- `peerDependencies` for react, PatternFly, react-query, react-router-dom
- CSS files copied to `dist/` alongside compiled JS

The downstream `packages/agent-ops/` in odh-dashboard installs it via `file:` protocol (dev) or npm version (production), adds webpack aliases to resolve from source (for CSS handling), and writes thin wrapper components + `extensions.ts`.

## Why not subtree

Our pages are self-contained with props — downstream wrappers don't need `~/app/` internal imports. Model-registry uses subtree because its wrappers reach into upstream internals (`ModelRegistryRoutes`, `AppContext`, etc.). Our slot system and prop-driven pages eliminate that need. npm is strictly simpler: version bump vs. patch-replay with conflict resolution.

## Why not direct monorepo

The project decision is standalone upstream repo (community, NVIDIA/OpenShell ecosystem, non-RHOAI users). Direct monorepo development would lose the community story.

## Consequences

- Need a CI publish pipeline (GitHub Actions → npm). Tracked in issue #11.
- `build:lib` must be run after upstream changes before downstream picks them up (dev workflow).
- `dist/` is in `.gitignore` — not committed.
- Downstream webpack config needs aliases to resolve source (not `dist/`) for CSS handling in dev mode.
