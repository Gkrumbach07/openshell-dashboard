import {
  apiAuthHeaders,
  apiFetch,
  apiUrl,
  sessionExpiredError,
  setApiBasePath,
  setAuthTokenGetter,
  setAuthTokenHeader,
  setSessionExpiredHandler,
} from '../client';

// The three functions a request that cannot go through apiFetch is built
// from, and that apiFetch itself is built from: where a request goes, what
// authenticates it, and what a 401 does.

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  setApiBasePath('');
  setAuthTokenGetter(null);
  setAuthTokenHeader('Authorization');
  setSessionExpiredHandler(null);
});

describe('apiUrl', () => {
  it('is the path itself while no base path is set', () => {
    expect(apiUrl('/api/v1/workspaces')).toBe('/api/v1/workspaces');
  });

  it('puts the path under the base path', () => {
    setApiBasePath('/openshell');
    expect(apiUrl('/api/v1/workspaces')).toBe('/openshell/api/v1/workspaces');
  });

  it('does not double the slash of a base path that ends in one', () => {
    setApiBasePath('/openshell/');
    expect(apiUrl('/api/v1/workspaces')).toBe('/openshell/api/v1/workspaces');
  });

  it('is the path itself again once the base path is cleared', () => {
    setApiBasePath('/openshell');
    setApiBasePath('');
    expect(apiUrl('/api/v1/workspaces')).toBe('/api/v1/workspaces');
  });
});

describe('apiAuthHeaders', () => {
  it('is empty while no token getter is set', async () => {
    await expect(apiAuthHeaders()).resolves.toEqual({});
  });

  it('carries the token of a getter that answers at once', async () => {
    setAuthTokenGetter(() => 'token-b');
    await expect(apiAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer token-b',
    });
  });

  it('waits for a getter that answers later', async () => {
    setAuthTokenGetter(
      () => new Promise((resolve) => setTimeout(() => resolve('fresh'), 0)),
    );
    await expect(apiAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer fresh',
    });
  });

  it.each([
    ['null', null],
    ['an empty token', ''],
  ])('is empty when the getter returns %s', async (_what, token) => {
    setAuthTokenGetter(() => token);
    await expect(apiAuthHeaders()).resolves.toEqual({});
  });

  it('is empty again once the getter is cleared', async () => {
    setAuthTokenGetter(() => 'token-b');
    setAuthTokenGetter(null);
    await expect(apiAuthHeaders()).resolves.toEqual({});
  });

  it('puts the token on the header that was chosen for it', async () => {
    setAuthTokenGetter(() => 'token-b');
    setAuthTokenHeader('X-OpenShell-Authorization');
    await expect(apiAuthHeaders()).resolves.toEqual({
      'X-OpenShell-Authorization': 'Bearer token-b',
    });
  });

  it('asks the getter once per call, so that each request gets a fresh token', async () => {
    const getter = jest
      .fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce('second');
    setAuthTokenGetter(getter);
    await expect(apiAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer first',
    });
    await expect(apiAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer second',
    });
    expect(getter).toHaveBeenCalledTimes(2);
  });
});

describe('sessionExpiredError', () => {
  it('runs the session-expired handler once per call', () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    sessionExpiredError();
    expect(onExpired).toHaveBeenCalledTimes(1);
    sessionExpiredError();
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('returns the error to throw: a 401 that says the session expired', () => {
    const error = sessionExpiredError('unauthorized');
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthorized');
    expect(error.message).toBe('Session expired');
  });

  it('returns the error without a handler to run', () => {
    expect(sessionExpiredError().status).toBe(401);
  });

  it('does not run a handler that was cleared', () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    setSessionExpiredHandler(null);
    sessionExpiredError();
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('apiFetch', () => {
  const ok = { ok: true, json: () => Promise.resolve({}) };

  it('sends the request to the URL apiUrl gives, with the headers apiAuthHeaders gives', async () => {
    setApiBasePath('/openshell');
    setAuthTokenGetter(async () => 'token-b');
    setAuthTokenHeader('X-OpenShell-Authorization');
    mockFetch.mockResolvedValueOnce(ok);

    await apiFetch('/api/v1/workspaces');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/openshell/api/v1/workspaces');
    expect(init.headers).toEqual({
      'X-OpenShell-Authorization': 'Bearer token-b',
    });
  });

  it('sends no auth header when the getter has no token', async () => {
    setAuthTokenGetter(() => null);
    mockFetch.mockResolvedValueOnce(ok);
    await apiFetch('/api/v1/workspaces');
    expect(mockFetch.mock.calls[0][1].headers).toEqual({});
  });

  it('lets the token replace a header of the same name the caller set', async () => {
    setAuthTokenGetter(() => 'token-b');
    mockFetch.mockResolvedValueOnce(ok);
    await apiFetch('/api/v1/workspaces', {
      headers: { Authorization: 'Bearer stale' },
    });
    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer token-b',
    });
  });

  it('sends the request before it first yields when there is no getter to wait for', () => {
    mockFetch.mockResolvedValueOnce(ok);
    void apiFetch('/api/v1/workspaces');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('runs the session-expired handler once for one 401', async () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ code: 'unauthorized' }),
    });

    await expect(apiFetch('/api/v1/workspaces')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Session expired',
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('leaves the handler alone for an error that is not a 401', async () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'forbidden' }),
    });
    await expect(apiFetch('/api/v1/workspaces')).rejects.toMatchObject({
      status: 403,
    });
    expect(onExpired).not.toHaveBeenCalled();
  });
});
