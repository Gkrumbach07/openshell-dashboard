import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { post, put } from '../client';
import {
  useApproveAllDraftChunks,
  useApproveDraftChunk,
  useClearDraftChunks,
  useEditDraftChunk,
  useRejectDraftChunk,
  useUndoDraftChunk,
} from '../policy';
import { allWorkspacesKeys, policyKeys } from '../queryKeys';

// The hooks are the real ones, on a real query client; only the HTTP calls
// under them are stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

// Every query a page can be showing when a proposal in team-a/agent is
// decided: the sandbox's own inbox and policy, and each count a summary
// carries — the workspace's and the one across every workspace.
const KEYS = {
  drafts: policyKeys.drafts('team-a', 'agent', 'pending'),
  history: policyKeys.draftHistory('team-a', 'agent'),
  policy: policyKeys.sandbox('team-a', 'agent'),
  workspaceSummary: policyKeys.workspaceDraftSummary('team-a'),
  otherWorkspaceSummary: policyKeys.workspaceDraftSummary('team-b'),
  allWorkspacesSummary: allWorkspacesKeys.draftSummary,
  otherDrafts: policyKeys.drafts('team-a', 'other', 'pending'),
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
  (post as jest.Mock).mockResolvedValue({});
  (put as jest.Mock).mockResolvedValue({ edited: true });
});

type Wrapper = ReturnType<typeof setup>['wrapper'];

const decisions: [string, (wrapper: Wrapper) => Promise<void>][] = [
  [
    'approving a chunk',
    async (wrapper) => {
      const { result } = renderHook(
        () => useApproveDraftChunk('team-a', 'agent'),
        { wrapper },
      );
      await act(() => result.current.mutateAsync({ chunkId: 'c1' }));
    },
  ],
  [
    'rejecting a chunk',
    async (wrapper) => {
      const { result } = renderHook(
        () => useRejectDraftChunk('team-a', 'agent'),
        { wrapper },
      );
      await act(() => result.current.mutateAsync({ chunkId: 'c1' }));
    },
  ],
  [
    'approving every chunk',
    async (wrapper) => {
      const { result } = renderHook(
        () => useApproveAllDraftChunks('team-a', 'agent'),
        { wrapper },
      );
      await act(() => result.current.mutateAsync(false));
    },
  ],
  [
    'editing a chunk',
    async (wrapper) => {
      const { result } = renderHook(
        () => useEditDraftChunk('team-a', 'agent'),
        { wrapper },
      );
      await act(() =>
        result.current.mutateAsync({
          chunkId: 'c1',
          proposedRule: { name: 'pypi', endpoints: [], binaries: [] },
        }),
      );
    },
  ],
  [
    'undoing a chunk',
    async (wrapper) => {
      const { result } = renderHook(
        () => useUndoDraftChunk('team-a', 'agent'),
        { wrapper },
      );
      await act(() => result.current.mutateAsync('c1'));
    },
  ],
  [
    'clearing the chunks',
    async (wrapper) => {
      const { result } = renderHook(
        () => useClearDraftChunks('team-a', 'agent'),
        { wrapper },
      );
      await act(() => result.current.mutateAsync(undefined));
    },
  ],
];

describe('a decision on a proposal', () => {
  it.each(decisions)(
    '%s re-reads the inbox, the policy and every pending count',
    async (_label, run) => {
      const { wrapper, invalidated } = setup();
      await run(wrapper);

      expect(invalidated(KEYS.drafts)).toBe(true);
      expect(invalidated(KEYS.history)).toBe(true);
      expect(invalidated(KEYS.policy)).toBe(true);
      // The nav badge, the Gateway page and the Proposals page count from
      // these; a decision must not leave them showing the chunk as waiting.
      expect(invalidated(KEYS.workspaceSummary)).toBe(true);
      expect(invalidated(KEYS.otherWorkspaceSummary)).toBe(true);
      expect(invalidated(KEYS.allWorkspacesSummary)).toBe(true);
      // Another sandbox's inbox is left alone.
      expect(invalidated(KEYS.otherDrafts)).toBe(false);
    },
  );
});
