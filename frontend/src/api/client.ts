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
let authTokenGetter: (() => string | null | Promise<string | null>) | null =
  null;
// Header the bearer is attached to. Defaults to the standard `Authorization`.
// An embedding host whose fronting proxy OWNS `Authorization` (e.g. RHOAI's
// data-science-gateway rewrites it to the platform's own access token) must
// carry the OpenShell token (Token B) on a dedicated header the proxy leaves
// untouched, and translate it back on its side. See setAuthTokenHeader.
let authTokenHeader = 'Authorization';

export const setApiBasePath = (basePath: string): void => {
  apiBasePath = basePath.replace(/\/+$/, '');
};

export const getApiBasePath = (): string => apiBasePath;

export const setSessionExpiredHandler = (
  handler: (() => void) | null,
): void => {
  onSessionExpired = handler;
};

/**
 * Optional per-request bearer provider.
 *
 * By default the package attaches no Authorization header — auth is injected by
 * the deployment's fronting proxy (ADR 0002/0014). But when the package is
 * embedded in a host that authenticates to a *second* service (e.g. RHOAI
 * embedding OpenShell — the "double auth" case), the host must supply the
 * OpenShell token itself. Register an async getter here: it is awaited before
 * every request, so the host can drive a browser-side silent OIDC (prompt=none)
 * refresh and return a fresh token per call. Return null to send no header
 * (falls back to the proxy-relay model).
 */
export const setAuthTokenGetter = (
  getter: (() => string | null | Promise<string | null>) | null,
): void => {
  authTokenGetter = getter;
};

/**
 * Override the header the bearer is attached to (default `Authorization`).
 *
 * Use when the embedding host's fronting proxy claims `Authorization` for its
 * own credential — the OpenShell token then rides a dedicated header (e.g.
 * `X-OpenShell-Authorization`) that the proxy passes through untouched, and the
 * host's proxy translates it back into what the OpenShell relay BFF expects.
 * The value is always sent as `Bearer <token>` regardless of header name.
 */
export const setAuthTokenHeader = (name: string): void => {
  authTokenHeader = name.trim() || 'Authorization';
};

export const apiFetch = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // Auth is normally injected by the deployment's fronting proxy (ADR 0002) —
  // no Authorization header, no token in JS. When embedded in a host that must
  // authenticate to OpenShell as a second service, the host registers an auth
  // token getter (setAuthTokenGetter) that supplies the bearer per request.
  if (authTokenGetter) {
    const token = await authTokenGetter();
    if (token) {
      headers[authTokenHeader] = `Bearer ${token}`;
    }
  }
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
      onSessionExpired?.();
      throw buildError(401, code, 'Session expired');
    }

    throw buildError(response.status, code, message);
  }
  return (await response.json()) as T;
};

export const get = <T>(path: string): Promise<T> => apiFetch<T>(path);

export const post = <T>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const put = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const del = <T>(path: string): Promise<T> =>
  apiFetch<T>(path, { method: 'DELETE' });
