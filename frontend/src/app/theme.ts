import { useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'openshell-dashboard-theme';
const DARK_THEME_CLASS = 'pf-v6-theme-dark';

export const getStoredTheme = (): Theme | null => {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
};

export const getSystemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle(DARK_THEME_CLASS, theme === 'dark');
};

export const initTheme = (): Theme => {
  const theme = getStoredTheme() ?? getSystemTheme();
  applyTheme(theme);
  return theme;
};

export const useTheme = (): { theme: Theme; toggleTheme: () => void } => {
  const [theme, setTheme] = useState<Theme>(
    () => getStoredTheme() ?? getSystemTheme(),
  );

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
  };

  return { theme, toggleTheme };
};
