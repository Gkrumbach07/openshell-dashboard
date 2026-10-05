import {
  apiFetch,
  get,
  post,
  put,
  del,
  isUnimplemented,
  setSessionExpiredHandler,
} from '../client';
import type { ApiError } from '../client';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  setSessionExpiredHandler(null);
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [1, 2] }),
    });

    const result = await apiFetch<{ items: number[] }>('/api/v1/items');
    expect(result).toEqual({ items: [1, 2] });
  });

  it('throws ApiError with status and code on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () =>
        Promise.resolve({ code: 'not_found', message: 'Sandbox not found' }),
    });

    try {
      await apiFetch('/api/v1/sandboxes/missing');
      fail('should have thrown');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.code).toBe('not_found');
      expect(err.message).toBe('Sandbox not found');
    }
  });

  it('handles non-JSON error body gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    });

    try {
      await apiFetch('/api/v1/gateway');
      fail('should have thrown');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(502);
      expect(err.message).toBe('Request failed (502)');
    }
  });

  it('sets Content-Type when body is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiFetch('/api/v1/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('does not set Content-Type when no body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiFetch('/api/v1/test');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('throws on 401 without invoking a session handler when none is set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ code: 'unauthorized', message: 'not authenticated' }),
    });

    await expect(apiFetch('/api/v1/workspaces')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('invokes session expired handler on 401', async () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ code: 'unauthorized', message: 'not authenticated' }),
    });

    await expect(apiFetch('/api/v1/workspaces')).rejects.toMatchObject({
      status: 401,
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('clears session handler when set to null', async () => {
    const onExpired = jest.fn();
    setSessionExpiredHandler(onExpired);
    setSessionExpiredHandler(null);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ code: 'unauthorized', message: 'not authenticated' }),
    });

    await expect(apiFetch('/api/v1/workspaces')).rejects.toMatchObject({
      status: 401,
    });
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('isUnimplemented', () => {
  it('recognises the BFF 501 for an RPC the gateway does not have', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      json: () =>
        Promise.resolve({
          code: 'unimplemented',
          message: 'this OpenShell gateway does not support this operation',
        }),
    });

    const error = await apiFetch('/api/v1/workspaces/default/templates').catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 501, code: 'unimplemented' });
    expect(isUnimplemented(error)).toBe(true);
  });

  it('is false for every other failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ code: 'internal', message: 'internal error' }),
    });

    const error = await apiFetch('/api/v1/workspaces/default/templates').catch(
      (e: unknown) => e,
    );
    expect(isUnimplemented(error)).toBe(false);
    expect(isUnimplemented(new Error('network down'))).toBe(false);
    expect(isUnimplemented(null)).toBe(false);
    expect(isUnimplemented(undefined)).toBe(false);
  });
});

describe('convenience methods', () => {
  it('get calls fetch with default GET', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    const result = await get('/api/v1/list');
    expect(result).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/list');
  });

  it('post sends POST with JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ created: true }),
    });
    await post('/api/v1/items', { name: 'test' });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'test' });
  });

  it('put sends PUT with JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ updated: true }),
    });
    await put('/api/v1/items/1', { name: 'updated' });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('PUT');
  });

  it('del sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    });
    await del('/api/v1/items/1');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('DELETE');
  });
});
