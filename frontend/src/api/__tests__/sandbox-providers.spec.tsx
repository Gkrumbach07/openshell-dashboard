import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { del, post } from '../client';
import { policyKeys, sandboxKeys } from '../queryKeys';
import { useAttachProvider, useDetachProvider } from '../sandboxes';

// The hooks are the real ones, on a real query client; only the HTTP calls
// under them are stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

// Every query a page can be showing when a provider is attached to a sandbox
// or detached from it.
const KEYS = {
  attached: sandboxKeys.providers('team-a', 'agent'),
  sandbox: sandboxKeys.detail('team-a', 'agent'),
  // The gateway composes one `_provider_*` rule per attached provider into
  // what the sandbox enforces.
  effectivePolicy: policyKeys.effective('team-a', 'agent'),
  ownPolicy: policyKeys.sandbox('team-a', 'agent'),
  otherSandbox: sandboxKeys.detail('team-a', 'other'),
  otherEffectivePolicy: policyKeys.effective('team-a', 'other'),
};

const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  Object.values(KEYS).forEach((key) => client.setQueryData(key, 'cached'));
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const invalidated = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated;
  return { wrapper, invalidated };
};

beforeEach(() => {
  jest.clearAllMocks();
  (post as jest.Mock).mockResolvedValue({ attached: true });
  (del as jest.Mock).mockResolvedValue({ detached: true });
});

// Each case runs its mutation and answers with a way to ask which queries it
// marked for re-reading.
const cases: [
  string,
  () => Promise<ReturnType<typeof setup>['invalidated']>,
][] = [
  [
    'attaching a provider',
    async () => {
      const { wrapper, invalidated } = setup();
      const { result } = renderHook(
        () => useAttachProvider('team-a', 'agent'),
        { wrapper },
      );
      await act(async () => {
        await result.current.mutateAsync({ provider: 'github' });
      });
      expect(post).toHaveBeenCalledTimes(1);
      return invalidated;
    },
  ],
  [
    'detaching a provider',
    async () => {
      const { wrapper, invalidated } = setup();
      const { result } = renderHook(
        () => useDetachProvider('team-a', 'agent'),
        { wrapper },
      );
      await act(async () => {
        await result.current.mutateAsync('github');
      });
      expect(del).toHaveBeenCalledTimes(1);
      return invalidated;
    },
  ],
];

describe.each(cases)('%s', (_name, run) => {
  it('re-reads the providers attached to the sandbox, and the sandbox', async () => {
    const invalidated = await run();
    expect(invalidated(KEYS.attached)).toBe(true);
    expect(invalidated(KEYS.sandbox)).toBe(true);
  });

  it('re-reads the effective policy, which holds a rule per attached provider', async () => {
    const invalidated = await run();
    expect(invalidated(KEYS.effectivePolicy)).toBe(true);
  });

  it("leaves the sandbox's own policy and every other sandbox alone", async () => {
    const invalidated = await run();
    expect(invalidated(KEYS.ownPolicy)).toBe(false);
    expect(invalidated(KEYS.otherSandbox)).toBe(false);
    expect(invalidated(KEYS.otherEffectivePolicy)).toBe(false);
  });
});
