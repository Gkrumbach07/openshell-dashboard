# Internationalization (i18n)

Decision record: [ADR 0004](../../../docs/adrs/0004-frontend.md), decision 5. This file covers contributor usage.

New UI copy goes through message keys and English catalogs. The shell, sign-in and the workspace list are migrated; the other pages still have their text inline. The catalogs are **English only**, and there is no language picker.

## Contributor usage

```tsx
import { useI18n } from '../i18n';

const { t } = useI18n('workspaces');
return <Button>{t('create')}</Button>;
```

- Import `useI18n` from this directory by relative path (`'../i18n'`). Do not import `i18next` / `react-i18next` from pages or components; ESLint rejects it.
- Namespaces: `common` (shell + shared actions), `auth` (login), `workspaces` (workspace list), `sandboxes` (sandbox details).
- Prefer nested keys (`empty.title`), not English-as-key.
- Interpolation: `t('delete.toast', { name })`.
- **Do not translate:** product name “OpenShell”, opaque API IDs/names, technical codes, gateway/BFF `.message` strings.
- Missing keys return the key string (never blank). Keep the English catalogs complete for what has been migrated.
- Avoid `<Trans>`: call `t()` with a string.

### Adding a key

1. Add the English value under `locales/en/<namespace>.ts`.
2. Call `t('…')` with `useI18n('<namespace>')`.
