# ADR 0004: Self-Contained Page Components for Downstream Reuse

**Status:** Accepted  
**Date:** 2026-08-05  
**Authors:** Gage Krumbach

## Context

The OpenShell Dashboard pages must be importable by downstream consumers (odh-dashboard) and wrapped with platform-specific context (navigation, auth, breadcrumbs). We evaluated:

1. **Pages coupled to the app shell** — use `useNavigate`, `useSearchParams`, global context directly
2. **Pages accept props for all behavior** — callbacks for navigation, controlled state for tabs, slot system for injected components

## Decision

Self-contained page components with optional callback props and a slot system:

- Every page takes explicit props (`workspace`, `sandboxName`, etc.) and uses internal API hooks for data fetching
- Navigation is via optional callbacks (`onSelect`, `onViewSandbox`, `onTabChange`) that fall back to `useNavigate`/`useSearchParams` when not provided
- Injected UI components use the `SlotProvider` context (`credentialInput`, `modelPicker`, `workspaceBinding`, etc.)
- No breadcrumbs in pages — the standalone shell adds its own, downstream adds its own
- Zero custom CSS — pure PatternFly 6 components and utility classes
- All pages exported via barrel at `src/pages/index.ts`

## Why fallbacks instead of requiring callbacks

Making callbacks required would break the standalone app (every page would need explicit wiring in `App.tsx`). Optional callbacks with `useNavigate` fallback means pages work out of the box in standalone mode and are overridable in federated mode. This matches how `onSelect` already worked — we extended the pattern to `onViewSandbox` and `onTabChange`.

## Consequences

- Downstream wrappers are thin (~15 lines each): import page, pass props, provide navigation callbacks
- Pages still depend on `react-router-dom` (for fallback hooks) — downstream must provide a Router context
- The `useSearchParams` hook in `SandboxDetailPage` is called unconditionally even in controlled mode — accepted tradeoff (any React app consuming this will have a Router)
- No `@odh-dashboard/*` imports in page components — the upstream repo has no knowledge of the downstream platform
