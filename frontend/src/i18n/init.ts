import i18n from 'i18next';
import type { InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { catalogs } from './catalogs';

const NAMESPACES = ['common', 'auth', 'workspaces'] as const;

export const defaultI18nOptions: InitOptions = {
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [...NAMESPACES],
  resources: catalogs,
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
  react: { useSuspense: false },
};

function mergeEnglishCatalogs(): void {
  for (const ns of NAMESPACES) {
    // overwrite: false — host English keys win; we only fill gaps.
    i18n.addResourceBundle('en', ns, catalogs.en[ns], true, false);
  }
}

let ensured = false;

export function ensureI18n(): void {
  if (ensured) {
    return;
  }
  ensured = true;

  if (i18n.isInitialized) {
    mergeEnglishCatalogs();
    return;
  }

  void i18n.use(initReactI18next).init(defaultI18nOptions);
}
