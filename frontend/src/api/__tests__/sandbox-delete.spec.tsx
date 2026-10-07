import React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { del } from '../client';
import { sandboxKeys } from '../queryKeys';
import { useDeleteSandbox } from '../sandboxes';

// The hook is the real one, on a real query client; only the HTTP call under
// it is stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (del as jest.Mock).mockResolvedValue({ outcome: 'completed', deleted: true });
});

// Seen on a Kubernetes-driver gateway: the page that deletes a sandbox is
// showing it, so its detail query is active. Once the sandbox is gone that
// query's refetch fails, and React Query holds a failed query's retry back
// while the tab is hidden. A delete that waited for the refetch never
// finished, and its dialog kept spinning over a sandbox that no longer
// existed.
it('finishes without waiting for a re-read of the sandbox it deleted', async () => {
  const client = new QueryClient();
  // The re-read of the deleted sandbox never settles, as it does not while
  // its retry is held back.
  let reads = 0;
  const readSandbox = jest.fn(() => {
    reads += 1;
    return reads === 1
      ? Promise.resolve({ metadata: { name: 'agent' } })
      : new Promise(() => undefined);
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(
    () => ({
      // What the detail page has mounted.
      sandbox: useQuery({
        queryKey: sandboxKeys.detail('team-a', 'agent'),
        queryFn: readSandbox,
      }),
      remove: useDeleteSandbox('team-a'),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.sandbox.isSuccess).toBe(true));

  const onSuccess = jest.fn();
  act(() => {
    result.current.remove.mutate('agent', { onSuccess });
  });

  // The caller hears of the delete: this is where the page closes its dialog
  // and leaves.
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(result.current.remove.isPending).toBe(false);
  // And the workspace's sandbox queries were still marked for re-reading.
  expect(readSandbox).toHaveBeenCalledTimes(2);
  expect(
    client.getQueryState(sandboxKeys.detail('team-a', 'agent'))?.fetchStatus,
  ).toBe('fetching');

  client.clear();
});
