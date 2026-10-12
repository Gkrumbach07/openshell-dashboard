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
// Header the bearer is attached to when a token getter is set. Defaults to
// the standard `Authorization`. See setAuthTokenHeader.
let authTokenHeader = 'Authorization';

/**
 * Set a path that every API URL is put under (see `apiUrl`). Trailing slashes
 * are dropped, and an empty string clears it. The dashboard does not call
 * this: its base path is always empty.
 */
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
 * By default the client attaches no Authorization header: auth is injected by
 * the auth proxy in front of the BFF (ADR 0002). The dashboard does not call
 * this, so no getter is ever set. When one is set, it is awaited before every
 * HTTP request and its token is sent as the bearer. Returning null sends no
 * header, which leaves auth to the proxy again.
 */
export const setAuthTokenGetter = (
  getter: (() => string | null | Promise<string | null>) | null,
): void => {
  authTokenGetter = getter;
};

/**
 * Override the header the token getter's bearer is attached to (default
 * `Authorization`). An empty name restores the default. The value is always
 * sent as `Bearer <token>` regardless of header name. The dashboard does not
 * call this.
 */
export const setAuthTokenHeader = (name: string): void => {
  authTokenHeader = name.trim() || 'Authorization';
};

/**
 * The URL a request for an API path is sent to: the path under the base path
 * set with `setApiBasePath`, or the path itself while none is set.
 *
 * `apiFetch` builds its URL with this. It is exported for the requests
 * `apiFetch` cannot make, because they do not send or receive JSON: a
 * multipart upload and a download read as a blob. `path` is appended as it
 * is (it starts with `/api/v1`).
 */
export const apiUrl = (path: string): string => `${apiBasePath}${path}`;

/**
 * The headers that authenticate a request: the token of the getter set with
 * `setAuthTokenGetter`, as `Bearer <token>`, on the header set with
 * `setAuthTokenHeader` (`Authorization` unless changed).
 *
 * The getter is called once per call, so a getter that refreshes its token
 * gets to do so before every request. The result is empty when no getter is
 * set, and when the getter returns null or an empty token: auth is then left
 * to the auth proxy (ADR 0002).
 *
 * `apiFetch` attaches exactly these. It is exported for the requests
 * `apiFetch` cannot make (see `apiUrl`), so that every HTTP request carries
 * them.
 */
export const apiAuthHeaders = async (): Promise<Record<string, string>> => {
  if (!authTokenGetter) {
    return {};
  }
  const token = await authTokenGetter();
  return token ? { [authTokenHeader]: `Bearer ${token}` } : {};
};

/**
 * What a 401 means to the client: the handler set with
 * `setSessionExpiredHandler` is run, once per call, and the error to throw is
 * returned (status 401, message "Session expired", and the `code` of the
 * response when it had one).
 *
 * `apiFetch` calls this for every 401 it receives. It is exported for the
 * requests `apiFetch` cannot make (see `apiUrl`), which call it for theirs,
 * so the handler runs for a 401 on any HTTP request. Call it only for a
 * response that was a 401.
 */
export const sessionExpiredError = (code?: string): ApiError => {
  onSessionExpired?.();
  return buildError(401, code, 'Session expired');
};

export const apiFetch = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // Auth is injected by the auth proxy in front of the BFF (ADR 0002): no
  // Authorization header, no token in JS. Only when a token getter has been
  // set (setAuthTokenGetter) is a bearer attached here. Without a getter
  // there is nothing to wait for, and the request is sent before apiFetch
  // first yields.
  if (authTokenGetter) {
    Object.assign(headers, await apiAuthHeaders());
  }
  const response = await fetch(apiUrl(path), { ...init, headers });
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
      throw sessionExpiredError(code);
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
