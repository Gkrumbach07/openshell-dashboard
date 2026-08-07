// Client-side auth state. Real sessions live in an HttpOnly cookie managed by
// the BFF — JavaScript never sees a token. The only state kept here is the
// dev-mode flag ("Continue as developer" when AUTH_DISABLED=true), which is
// not a credential.
const DEV_MODE_KEY = 'openshell-dashboard.devMode';

export const isDevSession = (): boolean =>
  window.sessionStorage.getItem(DEV_MODE_KEY) === 'true';

export const setDevSession = (): void => {
  window.sessionStorage.setItem(DEV_MODE_KEY, 'true');
};

export const clearDevSession = (): void => {
  window.sessionStorage.removeItem(DEV_MODE_KEY);
};
