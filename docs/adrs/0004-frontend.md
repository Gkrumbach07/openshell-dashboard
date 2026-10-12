# ADR 0004: Frontend: PatternFly 6, one API client, feature flags and an i18n facade

**Status:** Accepted
**Date:** 2026-10-11

## Context

The UI is a React and TypeScript single-page application, built with Vite and served by the BFF. Paths below are relative to `frontend/`.

## Decisions

1. **PatternFly 6 is the only design system.** There is no other component library and no stylesheet of the project's own. Layout and spacing come from PatternFly components, their props and its utility classes, with values from PatternFly tokens. A `style` prop is only for what PatternFly has no prop or utility class for. The stylesheets in the bundle are PatternFly's and the ones two widgets bring with them: xterm's for the terminal, and Monaco's for the code editor that PatternFly's `CodeEditor` wraps. The page also requests one web font from Google Fonts (`index.html`); the terminal falls back to PatternFly's monospace font without it.
2. **The shell owns the frame, and a page owns its content.** `src/app/` holds the routes, the layout, the breadcrumbs and the session. A page under `src/pages/` takes what it shows as props, loads its data through the hooks in `src/api/`, and renders no application chrome.
3. **Every request goes through one client.** `src/api/client.ts` builds the address, reads the error envelope and hands a `401` to the one session-expired handler ([ADR 0002](0002-auth-relay-only-bff.md)). A request that is not JSON (a multipart upload, a file download, the terminal's WebSocket) is built from the same module. Server state is kept in React Query, with keys from `src/api/queryKeys.ts`.
4. **Feature flags are deployment switches.** The BFF reads `FEATURE_*` from its environment and serves the values in `GET /api/v1/auth/config`; the UI reads them with `useFeatureFlags()` and hides what is off. Every flag defaults to on. A flag hides a feature. It does not close the BFF's route and it is not access control. A flag that nothing acts on is deleted.
5. **UI text goes through an i18n facade.** Pages and components get text from `useI18n` in `src/i18n` and do not import `i18next` or `react-i18next`; ESLint enforces it. The catalogs are English only: TypeScript modules under `src/i18n/locales/en/`, in the namespaces `common`, `auth` and `workspaces`. There is no language picker, and messages from the gateway and the BFF are not translated.

## Alternatives

- *Flags as build-time switches.* One image has to serve every deployment.
- *Flags as experiments or licence gates.* A flag exists because a deployment cannot or should not offer a feature, and for no other reason.
- *Import the i18n library in components directly.* The facade keeps the library replaceable and gives the linter one boundary to hold.

## Consequences

- Text not yet moved to a catalog is still inline. Moving it is ordinary work, not a change to this ADR.
- The Helm chart sets no `FEATURE_*` variable, so an install from the chart has every feature on ([Configuration](../configuration.md#feature-flags)).
