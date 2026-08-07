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

  // Auth rides on the BFF's HttpOnly session cookie (sent automatically on
  // same-origin requests) — no Authorization header, no token in JS.
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
      } else {
        window.location.assign('/login');
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
