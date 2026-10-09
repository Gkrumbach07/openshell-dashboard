import { getAuthConfig } from '../api/auth';
import { clearDevSession } from './authStore';

// Logout per auth mode (ADR 0002):
// - Dev (AUTH_DISABLED): the "session" is a client-side flag; clear it.
// - Proxied: the auth proxy owns the session and redirects after sign-out.
//   The default URL sends oauth2-proxy to its sign-in page instead of /.
export const logout = async (): Promise<void> => {
  clearDevSession();

  try {
    const config = await getAuthConfig();

    if (config.authDisabled) {
      window.location.assign('/login');
      return;
    }

    window.location.assign(
      config.logoutUrl || '/oauth2/sign_out?rd=/oauth2/sign_in',
    );
  } catch {
    window.location.assign('/login');
  }
};
