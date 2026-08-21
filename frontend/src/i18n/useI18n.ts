import { useTranslation } from 'react-i18next';

import { ensureI18n } from './init';

export function useI18n(ns: string | string[] = 'common') {
  // Init on first hook call, not module load, so catalog-only barrel
  // imports do not touch the default i18next singleton.
  ensureI18n();
  const { t, i18n } = useTranslation(ns);
  return { t, locale: i18n.language };
}
