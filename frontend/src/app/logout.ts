import { clearDevSession } from './authStore';

export const logout = (): void => {
  clearDevSession();
  window.location.assign('/oauth2/sign_out');
};
