const TOKEN_KEY = 'openshell-dashboard.token';
const REFRESH_KEY = 'openshell-dashboard.refreshToken';
const DEV_MODE_KEY = 'openshell-dashboard.devMode';

export const getToken = (): string | null =>
  window.sessionStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => {
  window.sessionStorage.setItem(TOKEN_KEY, token);
};

export const getRefreshToken = (): string | null =>
  window.sessionStorage.getItem(REFRESH_KEY);

export const setRefreshToken = (token: string): void => {
  window.sessionStorage.setItem(REFRESH_KEY, token);
};

export const clearToken = (): void => {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_KEY);
  window.sessionStorage.removeItem(DEV_MODE_KEY);
};

export const isDevSession = (): boolean =>
  window.sessionStorage.getItem(DEV_MODE_KEY) === 'true';

export const setDevSession = (): void => {
  window.sessionStorage.setItem(DEV_MODE_KEY, 'true');
};

export const hasSession = (): boolean => Boolean(getToken()) || isDevSession();
