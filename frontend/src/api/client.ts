import { isDevSession } from '../app/authStore';

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

let apiBasePath = '';
let onSessionExpired: (() => void) | null = null;
let reloadedFor401 = false;

export const setApiBasePath = (basePath: string): void => {
  apiBasePath = basePath.replace(/\/+$/, '');
};

export const setSessionExpiredHandler = (handler: () => void): void => {
  onSessionExpired = handler;
};

export const apiFetch = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // Auth is injected by the deployment's auth proxy (ADR 0003) — no
  // Authorization header, no token in JS.
  const response = await fetch(`${apiBasePath}${path}`, { ...init, headers });
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

    if (response.status === 401) {
      if (onSessionExpired) {
        onSessionExpired();
      } else if (isDevSession()) {
        // Dev mode registers a /login route; send the user back to it.
        window.location.assign('/login');
      } else if (!reloadedFor401) {
        // Proxied deployments have no /login route — the auth proxy owns
        // sign-in. Reload the page so the proxy can re-authenticate the
        // browser (it intercepts the document request and redirects to the
        // IdP). Guarded so repeated API 401s in one page life can't loop.
        reloadedFor401 = true;
        window.location.reload();
      }
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
