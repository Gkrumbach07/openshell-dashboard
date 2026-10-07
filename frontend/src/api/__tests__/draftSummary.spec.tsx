import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { DRAFT_SUMMARY_POLL_MS } from '../../constants';
import {
  getWorkspaceDraftSummary,
  useWorkspaceDraftSummary,
} from '../draftSummary';
import { policyKeys } from '../queryKeys';
import type { DraftSummary } from '../../types';

jest.mock('../client', () => ({
  get: jest.fn(),
}));

import { get } from '../client';
const mockGet = get as jest.Mock;

const summary: DraftSummary = {
  totalPending: 3,
  sandboxes: [
    {
      workspace: 'team-a',
      sandboxName: 'busy',
      pendingCount: 3,
      hasSecurityFlags: true,
      latestDraftMs: 1_700_000_000_000,
    },
    {
      workspace: 'team-a',
      sandboxName: 'denied',
      pendingCount: 0,
      hasSecurityFlags: false,
      latestDraftMs: 0,
      unavailable: true,
    },
  ],
};

const setup = (workspace: string, enabled?: boolean) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useWorkspaceDraftSummary(workspace, enabled), {
    wrapper,
  });
  return { ...hook, queryClient };
};

describe('workspace draft summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(summary);
  });

  it('reads the summary of one workspace on its own route', async () => {
    await getWorkspaceDraftSummary('team a');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/team%20a/draft-summary',
    );
  });

  it('keys the summary by workspace, under the key of every summary', () => {
    const key = policyKeys.workspaceDraftSummary('team-a');
    expect(key).not.toEqual(policyKeys.workspaceDraftSummary('team-b'));
    // Invalidating the summaries invalidates each workspace's.
    expect(key.slice(0, policyKeys.draftSummary.length)).toEqual([
      ...policyKeys.draftSummary,
    ]);
  });

  it('finds a sandbox by name, with pending rules or unavailable', async () => {
    const { result } = setup('team-a');
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(result.current.totalPending).toBe(3);
    expect(result.current.bySandbox.busy).toMatchObject({
      pendingCount: 3,
      hasSecurityFlags: true,
    });
    expect(result.current.bySandbox.denied).toMatchObject({
      unavailable: true,
    });
    // A sandbox the summary does not name has none pending.
    expect(result.current.bySandbox.quiet).toBeUndefined();
  });

  it('asks for nothing when draft policies are switched off', async () => {
    const { result } = setup('team-a', false);
    // Long enough for a request to have been made if one was going to be.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.bySandbox).toEqual({});
    expect(result.current.totalPending).toBe(0);
  });

  it('reads as nothing pending, and as failed, when the summary cannot be read', async () => {
    mockGet.mockRejectedValue(new Error('workspace role required'));
    const { result } = setup('team-a');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(result.current.bySandbox).toEqual({});
  });

  it('is re-read at the cadence the draft summary always had', async () => {
    const { result, queryClient } = setup('team-a');
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: policyKeys.workspaceDraftSummary('team-a') });
    const observer = query?.observers[0];
    expect(observer?.options.refetchInterval).toBe(DRAFT_SUMMARY_POLL_MS);
  });
});
