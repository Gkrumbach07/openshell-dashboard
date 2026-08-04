import { getAuthConfig } from '../api/auth';
import { clearDevSession } from './authStore';

export const logout = async (): Promise<void> => {
  clearDevSession();

  try {
    const config = await getAuthConfig();
    window.location.assign(config.logoutUrl ?? '/oauth2/sign_out');
  } catch {
    window.location.assign('/oauth2/sign_out');
  }
};
