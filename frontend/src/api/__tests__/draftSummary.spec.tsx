import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { DRAFT_SUMMARY_POLL_MS } from '../../constants';
import {
  getWorkspaceDraftSummary,
  useWorkspaceDraftSummary,
  useWorkspacesDraftSummaries,
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

const setup = (workspace: string, enabled?: boolean, names?: string[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useWorkspaceDraftSummary(workspace, enabled, names),
    {
      wrapper,
    },
  );
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

  it('sends only the names on the visible page', async () => {
    await getWorkspaceDraftSummary('team a', ['busy', 'quiet']);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/team%20a/draft-summary?sandbox=busy&sandbox=quiet',
    );
    expect(policyKeys.workspaceDraftSummary('team-a', ['busy'])).not.toEqual(
      policyKeys.workspaceDraftSummary('team-a', ['quiet']),
    );
  });

  it('makes no summary request when the page has no rows', async () => {
    expect(await getWorkspaceDraftSummary('team-a', [])).toEqual({
      sandboxes: [],
      totalPending: 0,
    });
    const { result } = setup('team-a', true, []);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.bySandbox).toEqual({});
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

// A promise per workspace, settled when the test says so.
const deferredReads = () => {
  const pending: Record<
    string,
    { resolve: (summary: DraftSummary) => void; reject: (e: Error) => void }
  > = {};
  mockGet.mockImplementation(
    (path: string) =>
      new Promise<DraftSummary>((resolve, reject) => {
        const workspace = decodeURIComponent(path.split('/')[4]);
        pending[workspace] = { resolve, reject };
      }),
  );
  return pending;
};

const setupMany = (workspaces: string[], enabled = true) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    (props: { enabled: boolean }) =>
      useWorkspacesDraftSummaries(workspaces, props.enabled),
    { wrapper, initialProps: { enabled } },
  );
};

const teamSummary = (workspace: string, pendingCount: number) => ({
  totalPending: pendingCount,
  sandboxes: [
    {
      workspace,
      sandboxName: 'agent',
      pendingCount,
      hasSecurityFlags: false,
      latestDraftMs: 0,
    },
  ],
});

describe('the summaries of several workspaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A list built from some of the workspaces would say nothing is waiting in
  // the ones still being read.
  it('is loading until every workspace has answered', async () => {
    const reads = deferredReads();
    const { result } = setupMany(['team-a', 'team-b']);
    await waitFor(() => expect(Object.keys(reads)).toHaveLength(2));
    expect(result.current.isLoading).toBe(true);

    reads['team-a'].resolve(teamSummary('team-a', 1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.isLoading).toBe(true);

    reads['team-b'].resolve(teamSummary('team-b', 2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.totalPending).toBe(3);
    expect(result.current.items).toHaveLength(2);
  });

  it('counts a workspace that failed as answered, and names it', async () => {
    const reads = deferredReads();
    const { result } = setupMany(['team-a', 'team-b']);
    await waitFor(() => expect(Object.keys(reads)).toHaveLength(2));

    reads['team-a'].resolve(teamSummary('team-a', 1));
    reads['team-b'].reject(new Error('workspace role required'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.failedWorkspaces).toEqual(['team-b']);
    expect(result.current.isError).toBe(false);
  });

  // The page renders once with the reads switched off (while the role is
  // being read) and then switches them on. The render that switches them on
  // must not be answered from the one before it.
  it('is loading from the render that switches the reads on', async () => {
    const reads = deferredReads();
    const { result, rerender } = setupMany(['team-a'], false);
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(reads['team-a']).toBeDefined());
    reads['team-a'].resolve(teamSummary('team-a', 1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.totalPending).toBe(1);
  });
});
