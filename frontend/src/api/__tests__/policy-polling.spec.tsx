import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { CONFIG_POLL_MS, POLICY_PENDING_POLL_MS } from '../../constants';
import { get } from '../client';
import {
  POLICY_PENDING_WATCH_MS,
  sandboxPolicyPollMs,
  useSandboxPolicy,
} from '../policy';
import type { PolicyStatus, SandboxPolicyView } from '../../types';

// The hook is the real one, on a real query client; only the HTTP call under
// it is stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

const mockGet = get as jest.Mock;

const view = (version: number, status: PolicyStatus): SandboxPolicyView => ({
  activeVersion: 1,
  latest: { version, status, createdAtMs: 1 },
  revisions: [],
});

const renderPolicy = (workspace = 'team-a', name = 'agent') => {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSandboxPolicy(workspace, name), { wrapper });
};

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

describe('sandboxPolicyPollMs', () => {
  it('is the slow pace while no revision is pending', () => {
    expect(sandboxPolicyPollMs(undefined)).toBe(CONFIG_POLL_MS);
  });

  it('is the fast pace for a revision that has only just been seen pending', () => {
    expect(sandboxPolicyPollMs(0)).toBe(POLICY_PENDING_POLL_MS);
    expect(sandboxPolicyPollMs(POLICY_PENDING_WATCH_MS - 1)).toBe(
      POLICY_PENDING_POLL_MS,
    );
  });

  it('is the slow pace again once the revision has been pending for the whole watch', () => {
    expect(sandboxPolicyPollMs(POLICY_PENDING_WATCH_MS)).toBe(CONFIG_POLL_MS);
    expect(sandboxPolicyPollMs(POLICY_PENDING_WATCH_MS * 100)).toBe(
      CONFIG_POLL_MS,
    );
  });

  it('watches for as long as `policy set --wait` waits by default', () => {
    expect(POLICY_PENDING_WATCH_MS).toBe(60_000);
  });
});

describe('useSandboxPolicy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGet.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('re-reads a policy with no pending revision at the slow pace', async () => {
    mockGet.mockResolvedValue(view(2, 'LOADED'));
    renderPolicy();
    await advance(0);
    expect(mockGet).toHaveBeenCalledTimes(1);

    await advance(CONFIG_POLL_MS - 1);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('re-reads a pending revision at the fast pace', async () => {
    mockGet.mockResolvedValue(view(3, 'PENDING'));
    renderPolicy();
    await advance(0);
    expect(mockGet).toHaveBeenCalledTimes(1);

    await advance(POLICY_PENDING_POLL_MS);
    expect(mockGet).toHaveBeenCalledTimes(2);
    await advance(POLICY_PENDING_POLL_MS);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  // A revision submitted to a stopped or a stuck sandbox is never loaded.
  it('stops re-reading a revision at the fast pace once it has waited the whole watch', async () => {
    mockGet.mockResolvedValue(view(3, 'PENDING'));
    renderPolicy();
    await advance(0);

    await advance(POLICY_PENDING_WATCH_MS);
    const duringWatch = mockGet.mock.calls.length;
    expect(duringWatch).toBeGreaterThan(
      POLICY_PENDING_WATCH_MS / POLICY_PENDING_POLL_MS / 2,
    );

    // Ten more minutes of the same pending revision: the slow pace, which is
    // twenty reads, where the fast pace would have made three hundred.
    const tenMinutes = 10 * 60_000;
    await advance(tenMinutes);
    const afterWatch = mockGet.mock.calls.length - duringWatch;
    expect(afterWatch).toBeGreaterThanOrEqual(tenMinutes / CONFIG_POLL_MS - 1);
    expect(afterWatch).toBeLessThanOrEqual(tenMinutes / CONFIG_POLL_MS + 1);
  });

  it('watches a newer pending revision afresh', async () => {
    mockGet.mockResolvedValue(view(3, 'PENDING'));
    renderPolicy();
    await advance(0);
    await advance(POLICY_PENDING_WATCH_MS + CONFIG_POLL_MS);

    // Revision 4 is submitted and waits in its turn.
    mockGet.mockResolvedValue(view(4, 'PENDING'));
    await advance(CONFIG_POLL_MS);
    const before = mockGet.mock.calls.length;
    await advance(POLICY_PENDING_POLL_MS * 5);
    expect(mockGet.mock.calls.length - before).toBe(5);
  });

  it('goes back to the slow pace as soon as the revision is loaded', async () => {
    mockGet.mockResolvedValue(view(3, 'PENDING'));
    renderPolicy();
    await advance(0);
    await advance(POLICY_PENDING_POLL_MS);

    mockGet.mockResolvedValue(view(3, 'LOADED'));
    await advance(POLICY_PENDING_POLL_MS);
    const settled = mockGet.mock.calls.length;

    await advance(CONFIG_POLL_MS - 1);
    expect(mockGet).toHaveBeenCalledTimes(settled);
    await advance(1);
    expect(mockGet).toHaveBeenCalledTimes(settled + 1);
  });
});
