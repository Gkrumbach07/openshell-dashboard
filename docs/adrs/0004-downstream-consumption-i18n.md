# ADR 0004: Downstream Consumption — i18n Extension (Mechanism 6)

**Status:** Accepted
**Date:** 2026-08-12
**Authors:** Daniel Reed
**Amends:** [ADR 0001](0001-downstream-consumption.md)

## Context

[ADR 0001](0001-downstream-consumption.md) established a closed extension
surface of exactly five mechanisms for downstream npm consumers. Issue
[#27](https://github.com/Gkrumbach07/openshell-dashboard/issues/27) adds
an internationalization stub so UI copy goes through message keys and
English catalogs before the page surface grows.

This is an explicit contract extension — not an internal implementation
detail. The original five mechanisms remain as documented in ADR 0001; this
ADR adds a sixth.

## Decision

Add **mechanism 6 — i18n** to the extension surface.

### Contract changes

**New barrel:** `openshell-dashboard/i18n` exports `useI18n`, `I18nProvider`,
`catalogs`, and `defaultI18nOptions`.

**Facade rule:** Pages and components import `useI18n` from `./i18n` only.
They do not import `i18next` or `react-i18next` directly. ESLint enforces
this boundary.

**English-only upstream catalogs:** The `catalogs` export contains English
strings for namespaces `common`, `auth`, and `workspaces`. Locale sources live
under `src/i18n/locales/en/` as TypeScript modules. The first `useI18n()`
call initializes English on the default i18next singleton so embedded pages
work with no required host provider. Importing only `catalogs`,
`defaultI18nOptions`, or `I18nProvider` does not initialize that singleton.

**Host override path:** Hosts that need copy overrides or additional locales
wrap embedded pages with `I18nProvider` and a host-owned i18next instance.
Integration examples live in
[`frontend/src/i18n/README.md`](../../frontend/src/i18n/README.md).

**Dependencies:** `i18next` and `react-i18next` are added to
`peerDependencies` and listed in `dependencies` so standalone and naive
hosts install them. Hosts that already ship i18next should dedupe.

**Build:** `build:lib` includes `src/i18n` in the compile graph. The published
`catalogs` object is inlined in `dist/i18n` (no runtime JSON imports).
`scripts/verify-lib-build.mjs` checks required barrel artifacts after compile.

### Versioning

Treat as a **minor** contract extension: new optional barrel; English UX is
unchanged for hosts that do nothing.

## Out of scope

Per issue #27:

- Additional locale files (es, fr, de, ja, zh, …)
- Language picker or locale setting in Settings
- Translating OpenShell gateway / BFF error payloads
- RTL layout support
- Locale-completeness CI (only useful once a second locale exists)

## Consequences

- Downstream hosts may ignore i18n for English-only embeds — published pages
  auto-init English on the first `useI18n()` call.
- Hosts that override copy or add locales must use the documented
  `I18nProvider` path.
- Further i18n contract changes (new required namespaces, in-package language
  picker, etc.) are separate amendments — not silent extensions of this ADR.
