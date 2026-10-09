import { getAuthConfig } from '../api/auth';
import { clearDevSession } from './authStore';

// Logout per auth mode (ADR 0002):
// - Dev (AUTH_DISABLED): the "session" is a client-side flag; clear it.
// - Proxied: the auth proxy owns the session. oauth2-proxy's sign-out redirects
//   to / by default, so complete sign-out before navigating to its sign-in page.
export const logout = async (): Promise<void> => {
  clearDevSession();

  try {
    const config = await getAuthConfig();

    if (config.authDisabled) {
      window.location.assign('/login');
      return;
    }

    const logoutUrl = config.logoutUrl || '/oauth2/sign_out';
    if (logoutUrl !== '/oauth2/sign_out') {
      window.location.assign(logoutUrl);
      return;
    }

    try {
      const response = await fetch(logoutUrl, {
        credentials: 'same-origin',
        redirect: 'manual',
      });
      // Browsers hide the 302 behind an opaque redirect response. At this
      // point oauth2-proxy has called backend logout and cleared its cookie.
      if (response.type === 'opaqueredirect') {
        window.location.replace('/oauth2/sign_in');
        return;
      }
    } catch {
      // If the request fails, use normal navigation so the proxy can still
      // clear the session instead of sending an authenticated user to sign-in.
    }
    window.location.assign(logoutUrl);
  } catch {
    window.location.assign('/login');
  }
};
