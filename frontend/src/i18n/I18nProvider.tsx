import type { i18n as I18nInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

type I18nProviderProps = {
  i18n: I18nInstance;
  children: ReactNode;
};

/** Thin facade over I18nextProvider for downstream hosts. */
export const I18nProvider: React.FC<I18nProviderProps> = ({
  i18n,
  children,
}) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
