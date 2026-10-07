import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import {
  useConfigureProviderRefresh,
  useCreateProvider,
  useUpdateProvider,
} from '../providers';
import { apiFetch, del, get, post, put } from '../client';

// The hooks are the real ones, on a real query client; only the HTTP calls
// under them are stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

const SECRET = 'sk-s3cr3t-value';

const wrapperFor = (client: QueryClient) => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

// Everything the query client still holds of the requests that were made.
const heldVariables = (client: QueryClient): string =>
  JSON.stringify(
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.variables),
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  for (const call of [get, post, put, del, apiFetch]) {
    (call as jest.Mock).mockResolvedValue({});
  }
});

afterEach(() => jest.useRealTimers());

// A request that creates or updates a provider, or configures its refresh,
// carries credential values. React Query keeps the variables of a mutation
// for five minutes after the last component that used it has gone, unless
// told otherwise; a host that embeds these pages owns the query client and
// may show or persist what is in it. So these are kept for no time at all.
describe('requests that carry credential values', () => {
  it.each<
    [string, () => { mutateAsync: (body: never) => Promise<unknown> }, unknown]
  >([
    [
      'creating a provider',
      () => useCreateProvider('team-a'),
      { name: 'gh', type: 'github', credentials: { GITHUB_TOKEN: SECRET } },
    ],
    [
      'updating a provider',
      () => useUpdateProvider('team-a'),
      { name: 'gh', credentials: { GITHUB_TOKEN: SECRET } },
    ],
    [
      'configuring refresh',
      () => useConfigureProviderRefresh('team-a', 'gh'),
      {
        credentialKey: 'GITHUB_TOKEN',
        strategy: 'oauth2-client-credentials',
        material: { client_secret: SECRET },
        secretMaterialKeys: ['client_secret'],
      },
    ],
  ])(
    'are not kept once the dialog that made them is gone: %s',
    async (_name, useMutationHook, body) => {
      const client = new QueryClient();
      const { result, unmount } = renderHook(useMutationHook, {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync(body as never);
      });
      // While the dialog is open the request is still its own to read: the
      // error of one that failed is shown from it.
      expect(heldVariables(client)).toContain(SECRET);

      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(heldVariables(client)).not.toContain(SECRET);
      expect(client.getMutationCache().getAll()).toHaveLength(0);
      client.clear();
    },
  );

  // The provider page stays mounted when the Configure refresh dialog closes:
  // it lets go of the request by resetting it.
  it('are not kept once the request is reset', async () => {
    const client = new QueryClient();
    const { result, unmount } = renderHook(
      () => useConfigureProviderRefresh('team-a', 'gh'),
      { wrapper: wrapperFor(client) },
    );
    await act(async () => {
      await result.current.mutateAsync({
        credentialKey: 'GITHUB_TOKEN',
        strategy: 'oauth2-client-credentials',
        material: { client_secret: SECRET },
      });
    });

    act(() => result.current.reset());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(heldVariables(client)).not.toContain(SECRET);
    unmount();
    client.clear();
  });

  it('are still there for a dialog that is open to show why one failed', async () => {
    (post as jest.Mock).mockRejectedValue(new Error('refused'));
    const client = new QueryClient();
    const { result, unmount } = renderHook(() => useCreateProvider('team-a'), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current
        .mutateAsync({
          name: 'gh',
          type: 'github',
          credentials: { GITHUB_TOKEN: SECRET },
        })
        .catch(() => undefined);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.isError).toBe(true);
    expect((result.current.error as Error).message).toBe('refused');
    unmount();
    client.clear();
  });
});
