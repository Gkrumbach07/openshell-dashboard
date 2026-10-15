import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useCurrentUser } from '../auth';
import { setSessionExpiredHandler } from '../client';
import { authKeys } from '../queryKeys';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  setSessionExpiredHandler(null);
});

afterEach(() => {
  setSessionExpiredHandler(null);
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
});

const wrapperFor = (queryClient: QueryClient) => {
  const QueryClientWrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return QueryClientWrapper;
};

describe('useCurrentUser', () => {
  it('isolates opt-out observers while preserving the default session callback', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onSessionExpired = jest.fn();
    setSessionExpiredHandler(onSessionExpired);
    const user = { subject: 'user-1', roles: ['admin'] };
    mockFetch
      .mockResolvedValueOnce(response(200, user))
      .mockResolvedValueOnce(response(200, user));

    const { result, unmount } = renderHook(
      () => ({
        silent: useCurrentUser({ notifySessionExpired: false }),
        standard: useCurrentUser(),
      }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(result.current.silent.data).toEqual(user);
      expect(result.current.standard.data).toEqual(user);
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
    expect(
      queryClient.getQueryCache().findAll({ queryKey: authKeys.whoami }),
    ).toHaveLength(2);

    mockFetch.mockResolvedValueOnce(
      response(401, { code: 'unauthenticated', message: 'token rejected' }),
    );
    await act(async () => {
      await result.current.silent.refetch();
    });
    expect(onSessionExpired).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(
      response(401, { code: 'unauthenticated', message: 'token rejected' }),
    );
    await act(async () => {
      await result.current.standard.refetch();
    });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    unmount();
    queryClient.clear();
  });
});
