import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { isUnimplemented } from '../client';
import { useTemplates } from '../templates';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
});

const failWith = (status: number, code: string, message: string) => ({
  ok: false,
  status,
  json: () => Promise.resolve({ code, message }),
});

// A fresh client per test so no result is served from another test's cache.
// retryDelay is shortened only to keep the retrying case fast.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })}
  >
    {children}
  </QueryClientProvider>
);

describe('useTemplates', () => {
  it('does not retry when the gateway has no sandbox templates (501)', async () => {
    mockFetch.mockResolvedValue(
      failWith(
        501,
        'unimplemented',
        'this OpenShell gateway does not support this operation',
      ),
    );

    const { result } = renderHook(() => useTemplates('default'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isUnimplemented(result.current.error)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('still retries any other failure once', async () => {
    mockFetch.mockResolvedValue(failWith(500, 'internal', 'internal error'));

    const { result } = renderHook(() => useTemplates('default'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isUnimplemented(result.current.error)).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
