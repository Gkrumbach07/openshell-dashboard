const DEV_MODE_KEY = 'openshell-dashboard.devMode';

export const isDevSession = (): boolean =>
  window.sessionStorage.getItem(DEV_MODE_KEY) === 'true';

export const setDevSession = (): void => {
  window.sessionStorage.setItem(DEV_MODE_KEY, 'true');
};

export const clearDevSession = (): void => {
  window.sessionStorage.removeItem(DEV_MODE_KEY);
};
