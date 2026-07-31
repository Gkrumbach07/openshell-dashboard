import { clearToken } from './authStore';

export const logout = async (): Promise<void> => {
  const postLogoutRedirect = `${window.location.origin}/login`;

  try {
    const response = await fetch(
      `/api/v1/auth/logout?redirect=${encodeURIComponent(postLogoutRedirect)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as { redirect: string };
      clearToken();
      window.location.assign(body.redirect);
      return;
    }
  } catch {
    // BFF unreachable — fall through.
  }

  clearToken();
  window.location.assign('/login');
};
