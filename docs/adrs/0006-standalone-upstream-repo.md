# ADR 0006: Standalone Upstream Repository

**Status:** Accepted
**Date:** 2026-08-04
**Authors:** Gage Krumbach

## Context

The OpenShell Dashboard could live in several places:

1. **Embedded in odh-dashboard** — develop directly in `packages/agent-ops/` inside the odh-dashboard monorepo. Fastest path for RHOAI integration.
2. **Embedded in NVIDIA/OpenShell** — part of the gateway repo. Closest to the API it wraps.
3. **Standalone repo in ai-openshell org** — independent project, consumed downstream via npm.

## Decision

Standalone upstream repo, targeting the `ai-openshell` GitHub org (neutral community org, not NVIDIA/OpenShell which has strict CI, not opendatahub-io which is RHOAI-specific).

The dashboard is an independent open-source project that works for anyone running an OpenShell gateway — community users, NVIDIA partners, harness integrators, enterprise deployments. It is not an RHOAI feature that happens to be open source.

Downstream consumption (RHOAI/odh-dashboard) happens via npm package installation, not code copying or monorepo development. See ADR 0002.

## Why not embedded in odh-dashboard

- Locks out the community. Non-RHOAI users can't use the dashboard without cloning odh-dashboard.
- Couples release cadence to RHOAI's. OpenShell moves faster than RHOAI release cycles.
- Makes it impossible for NVIDIA, harness partners (OpenClaw, Hermes), or other OpenShift teams to contribute without navigating odh-dashboard's codebase.

## Why not NVIDIA/OpenShell

- NVIDIA/OpenShell has strict CI and vouch requirements. A web dashboard has different development velocity needs than a Rust sandbox runtime.
- UI tooling (webpack, React, PatternFly) doesn't fit the Rust/Go toolchain.
- The neutral `ai-openshell` org builds community gravity across organizations.

## Consequences

- We maintain our own CI, release process, and npm publishing pipeline.
- The dashboard has zero imports from `@odh-dashboard/*` — enforced by convention and lint rules.
- Downstream integration requires a wrapper package (`packages/agent-ops/` in odh-dashboard) that imports our npm package and wires in platform context.
- Community contributors can clone one repo, run `make dev`, and start contributing without understanding RHOAI.
