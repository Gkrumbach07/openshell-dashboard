import {
  clearToken,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
} from '../app/authStore';
import { AUTH_REFRESH_PATH, ROUTES } from '../constants';

export type ApiError = Error & {
  status: number;
  code?: string;
};

const buildError = (
  status: number,
  code: string | undefined,
  message: string,
): ApiError => {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  return error;
};

// Attempt to refresh the access token using the stored refresh token.
// Returns the new access token on success, or null if refresh fails.
let refreshPromise: Promise<string | null> | null = null;

const tryRefresh = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  // Deduplicate concurrent refresh attempts
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(AUTH_REFRESH_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (body.accessToken) {
        setToken(body.accessToken);
        if (body.refreshToken) {
          setRefreshToken(body.refreshToken);
        }
        return body.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// Redirect to login, clearing session. Called once — prevents multiple
// components from each triggering a redirect.
let redirecting = false;

let onSessionExpired: (() => void) | null = null;

export const setSessionExpiredHandler = (handler: () => void): void => {
  onSessionExpired = handler;
};

const redirectToLogin = () => {
  if (redirecting) {
    return;
  }
  redirecting = true;
  clearToken();
  if (onSessionExpired) {
    onSessionExpired();
    redirecting = false;
  } else {
    window.location.assign(ROUTES.LOGIN);
  }
};

export const apiFetch = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let code: string | undefined;
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      code = body.code;
      if (body.message) {
        message = body.message;
      }
    } catch {
      // Non-JSON error body.
    }

    // BFF auth-middleware rejection means our token is invalid/expired.
    // Try refreshing; if that fails, redirect to login.
    if (response.status === 401 && code === 'unauthorized') {
      const newToken = await tryRefresh();
      if (newToken) {
        // Retry the original request with the new token
        headers.Authorization = `Bearer ${newToken}`;
        const retryResponse = await fetch(path, { ...init, headers });
        if (retryResponse.ok) {
          return (await retryResponse.json()) as T;
        }
      }
      // Refresh failed or retry failed — redirect to login
      redirectToLogin();
      throw buildError(401, code, 'Session expired');
    }

    throw buildError(response.status, code, message);
  }
  return (await response.json()) as T;
};

export const get = <T>(path: string): Promise<T> => apiFetch<T>(path);

export const post = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const put = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const del = <T>(path: string): Promise<T> =>
  apiFetch<T>(path, { method: 'DELETE' });
