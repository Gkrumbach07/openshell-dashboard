import { getAuthConfig } from '../api/auth';
import { clearDevSession, isDevSession } from './authStore';

export const logout = async (): Promise<void> => {
  clearDevSession();

  if (isDevSession()) {
    window.location.assign('/');
    return;
  }

  try {
    const config = await getAuthConfig();
    window.location.assign(config.logoutUrl ?? '/oauth2/sign_out');
  } catch {
    window.location.assign('/oauth2/sign_out');
  }
};
