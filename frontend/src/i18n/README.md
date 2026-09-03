# Internationalization (i18n)

Contract details: [ADR 0004](../../docs/adrs/0004-downstream-consumption-i18n.md). This file covers contributor usage and host integration.

UI copy goes through message keys and English catalogs. v1 ships **English only** — no language picker.

## Contributor usage

```tsx
import { useI18n } from '~/i18n';

const { t } = useI18n('workspaces');
return <Button>{t('create')}</Button>;
```

- Import **`useI18n` from `~/i18n` only**. Do not import `i18next` / `react-i18next` from pages or components.
- Namespaces: `common` (shell + shared actions), `auth` (login), `workspaces` (workspace list).
- Prefer nested keys (`empty.title`), not English-as-key.
- Interpolation: `t('delete.toast', { name })`.
- **Do not translate:** product name “OpenShell”, opaque API IDs/names, technical codes, gateway/BFF `.message` strings.
- Missing keys return the key string (never blank). Keep English catalogs complete for migrated surfaces.
- Avoid `<Trans>` in v1 — string-only `t()` is the path.

### Adding a key

1. Add the English value under `locales/en/<namespace>.ts`.
2. Call `t('…')` with `useI18n('<namespace>')`.
3. Prefer **additive** keys. Renames need a minor version note here.

## Downstream hosts

Published `catalogs` export contains English strings (compiled into `dist/i18n` as plain JS — no locale JSON files in the package). The first `useI18n()` call initializes English on the default i18next singleton. No required host provider for English. Importing only `catalogs` / `defaultI18nOptions` / `I18nProvider` does not initialize that singleton.

If the host already initialized the **default** singleton, `useI18n()` merges English `common` / `auth` / `workspaces` with `addResourceBundle(..., deep: true, overwrite: false)` (host keys win; missing dashboard keys are filled). For a separate instance (recommended when the host owns locale), use `createInstance()` below.

To override copy or add locales (e.g. `es` / `de`):

```tsx
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { catalogs, defaultI18nOptions, I18nProvider } from 'openshell-dashboard/i18n';

const hostI18n = i18n.createInstance();
void hostI18n.use(initReactI18next).init({
  ...defaultI18nOptions,
  lng: preferredLocale,
  resources: {
    en: catalogs.en,
    es: { /* host-owned JSON mirroring the same keys */ },
  },
});

<I18nProvider i18n={hostI18n}>
  <WorkspaceListPage … />
</I18nProvider>
```

Override nested English keys with deep merge or:

```ts
hostI18n.addResourceBundle(
  'en',
  'workspaces',
  { empty: { title: 'Projects' } },
  true,
  true,
);
```

Do **not** spread dotted keys like `'empty.title': '…'` — that creates a literal key.

Use `createInstance()` for host-owned instances. Deduplicate `i18next` (>= 26.3.4) and `react-i18next` with the dashboard package. Language switching is host-owned.
