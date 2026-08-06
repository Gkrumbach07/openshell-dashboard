import { getAuthConfig } from '../api/auth';
import { clearDevSession } from './authStore';

// Logout per auth mode:
// - Dev (AUTH_DISABLED): the "session" is a client-side flag; clear it.
// - Standalone OIDC: the BFF clears the HttpOnly session cookie and returns
//   the IdP's end-session URL so the SSO session is cleared too.
// - Federated: the auth proxy owns the session; redirect to its sign-out URL
//   (LOGOUT_URL, e.g. /oauth2/sign_out for oauth2-proxy).
export const logout = async (): Promise<void> => {
  clearDevSession();

  try {
    const config = await getAuthConfig();

    if (config.authDisabled) {
      window.location.assign('/login');
      return;
    }

    if (config.issuer && config.clientId) {
      const resp = await fetch('/api/v1/auth/logout', { method: 'POST' });
      const body = (await resp.json()) as { redirect?: string };
      window.location.assign(body.redirect ?? '/login');
      return;
    }

    window.location.assign(config.logoutUrl ?? '/oauth2/sign_out');
  } catch {
    window.location.assign('/login');
  }
};
