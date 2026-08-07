import { getAuthConfig } from '../api/auth';
import { clearDevSession } from './authStore';

// Logout per auth mode (ADR 0014):
// - Dev (AUTH_DISABLED): the "session" is a client-side flag; clear it.
// - Proxied: the auth proxy owns the session; redirect to its sign-out URL
//   (LOGOUT_URL, e.g. /oauth2/sign_out for oauth2-proxy).
export const logout = async (): Promise<void> => {
  clearDevSession();

  try {
    const config = await getAuthConfig();

    if (config.authDisabled) {
      window.location.assign('/login');
      return;
    }

    window.location.assign(config.logoutUrl || '/oauth2/sign_out');
  } catch {
    window.location.assign('/login');
  }
};
