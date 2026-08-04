import { useMemo } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { DRAFT_POLL_MS, DRAFT_SUMMARY_POLL_MS } from '../constants';
import { apiFetch, del, get, post, put } from './client';
import { policyKeys, sandboxKeys } from './queryKeys';
import type {
  DraftHistoryEntry,
  DraftPolicy,
  DraftSummary,
  NetworkPolicyRule,
  PolicyUpdateResult,
  SandboxPolicy,
  SandboxPolicyView,
} from '../types';

const sandboxBase = (workspace: string, name: string) =>
  `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}`;

export const getSandboxPolicy = (
  workspace: string,
  name: string,
): Promise<SandboxPolicyView> =>
  get<SandboxPolicyView>(`${sandboxBase(workspace, name)}/policy`);

export const updateSandboxPolicy = (
  workspace: string,
  name: string,
  policy: SandboxPolicy,
  expectedResourceVersion?: number,
): Promise<PolicyUpdateResult> =>
  apiFetch<PolicyUpdateResult>(`${sandboxBase(workspace, name)}/policy`, {
    method: 'PUT',
    body: JSON.stringify({ policy, expectedResourceVersion }),
  });

export const getGlobalPolicy = (): Promise<SandboxPolicyView> =>
  get<SandboxPolicyView>('/api/v1/global-policy');

export const setGlobalPolicy = (
  policy: SandboxPolicy,
): Promise<PolicyUpdateResult> =>
  apiFetch<PolicyUpdateResult>('/api/v1/global-policy', {
    method: 'PUT',
    body: JSON.stringify({ policy }),
  });

export const getDraftPolicy = (
  workspace: string,
  name: string,
  status?: string,
): Promise<DraftPolicy> =>
  get<DraftPolicy>(
    `${sandboxBase(workspace, name)}/drafts${status ? `?status=${encodeURIComponent(status)}` : ''}`,
  );

export const approveDraftChunk = (
  workspace: string,
  name: string,
  chunkId: string,
): Promise<PolicyUpdateResult> =>
  post<PolicyUpdateResult>(
    `${sandboxBase(workspace, name)}/drafts/${encodeURIComponent(chunkId)}/approve`,
    {},
  );

export const rejectDraftChunk = (
  workspace: string,
  name: string,
  chunkId: string,
  reason?: string,
): Promise<{ rejected: boolean }> =>
  post<{ rejected: boolean }>(
    `${sandboxBase(workspace, name)}/drafts/${encodeURIComponent(chunkId)}/reject`,
    { reason },
  );

export const approveAllDraftChunks = (
  workspace: string,
  name: string,
  includeSecurityFlagged: boolean,
): Promise<{ chunksApproved: number; chunksSkipped: number }> =>
  post<{ chunksApproved: number; chunksSkipped: number }>(
    `${sandboxBase(workspace, name)}/drafts/approve-all`,
    { includeSecurityFlagged },
  );

export const useSandboxPolicy = (workspace: string, name: string) =>
  useQuery({
    queryKey: policyKeys.sandbox(workspace, name),
    queryFn: () => getSandboxPolicy(workspace, name),
  });

export const useSandboxPolicies = (workspace: string, names: string[]) => {
  const queries = useQueries({
    queries: names.map((name) => ({
      queryKey: policyKeys.sandbox(workspace, name),
      queryFn: () => getSandboxPolicy(workspace, name),
    })),
  });

  const dataFingerprint = queries.map((q) => q.dataUpdatedAt).join(',');

  return useMemo(() => {
    const views: Record<string, SandboxPolicyView> = {};
    queries.forEach((q, i) => {
      if (q.data) views[names[i]] = q.data;
    });
    return views;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFingerprint]);
};

export const useUpdateSandboxPolicy = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      policy,
      expectedResourceVersion,
    }: {
      policy: SandboxPolicy;
      expectedResourceVersion?: number;
    }) => updateSandboxPolicy(workspace, name, policy, expectedResourceVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: policyKeys.sandbox(workspace, name),
      });
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.detail(workspace, name),
      });
    },
  });
};

export const useGlobalPolicy = () =>
  useQuery({ queryKey: policyKeys.global, queryFn: getGlobalPolicy });

export const useSetGlobalPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setGlobalPolicy,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: policyKeys.global }),
  });
};

export const deleteGlobalPolicy = (): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>('/api/v1/global-policy');

export const useDeleteGlobalPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteGlobalPolicy,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: policyKeys.global }),
  });
};

export const useDraftPolicy = (workspace: string, name: string) =>
  useQuery({
    queryKey: policyKeys.drafts(workspace, name),
    queryFn: () => getDraftPolicy(workspace, name),
    refetchInterval: DRAFT_POLL_MS,
  });

// Draft decisions invalidate both the inbox and the policy view (approvals
// bump the policy version).
const useDraftMutation = <TArgs, TResult>(
  workspace: string,
  name: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: policyKeys.drafts(workspace, name) });
      queryClient.invalidateQueries({
        queryKey: policyKeys.sandbox(workspace, name),
      });
    },
  });
};

export const useApproveDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(workspace, name, (chunkId: string) =>
    approveDraftChunk(workspace, name, chunkId),
  );

export const useRejectDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(
    workspace,
    name,
    ({ chunkId, reason }: { chunkId: string; reason?: string }) =>
      rejectDraftChunk(workspace, name, chunkId, reason),
  );

export const useApproveAllDraftChunks = (workspace: string, name: string) =>
  useDraftMutation(workspace, name, (includeSecurityFlagged: boolean) =>
    approveAllDraftChunks(workspace, name, includeSecurityFlagged),
  );

export const editDraftChunk = (
  workspace: string,
  name: string,
  chunkId: string,
  proposedRule: NetworkPolicyRule,
): Promise<{ edited: boolean }> =>
  put<{ edited: boolean }>(
    `${sandboxBase(workspace, name)}/drafts/${encodeURIComponent(chunkId)}`,
    { proposedRule },
  );

export const undoDraftChunk = (
  workspace: string,
  name: string,
  chunkId: string,
): Promise<PolicyUpdateResult> =>
  post<PolicyUpdateResult>(
    `${sandboxBase(workspace, name)}/drafts/${encodeURIComponent(chunkId)}/undo`,
    {},
  );

export const clearDraftChunks = (
  workspace: string,
  name: string,
): Promise<{ chunksCleared: number }> =>
  post<{ chunksCleared: number }>(
    `${sandboxBase(workspace, name)}/drafts/clear`,
    {},
  );

export const getDraftHistory = (
  workspace: string,
  name: string,
): Promise<DraftHistoryEntry[]> =>
  get<DraftHistoryEntry[]>(`${sandboxBase(workspace, name)}/drafts/history`);

export const useEditDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(
    workspace,
    name,
    ({
      chunkId,
      proposedRule,
    }: {
      chunkId: string;
      proposedRule: NetworkPolicyRule;
    }) => editDraftChunk(workspace, name, chunkId, proposedRule),
  );

export const useUndoDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(workspace, name, (chunkId: string) =>
    undoDraftChunk(workspace, name, chunkId),
  );

export const useClearDraftChunks = (workspace: string, name: string) =>
  useDraftMutation(workspace, name, () => clearDraftChunks(workspace, name));

export const useDraftHistory = (workspace: string, name: string) =>
  useQuery({
    queryKey: policyKeys.draftHistory(workspace, name),
    queryFn: () => getDraftHistory(workspace, name),
  });

const getDraftSummary = (workspace?: string): Promise<DraftSummary> =>
  get<DraftSummary>(
    `/api/v1/draft-summary${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`,
  );

export const useDraftNotifications = (enabled = true) => {
  const query = useQuery({
    queryKey: policyKeys.draftSummary,
    queryFn: () => getDraftSummary(),
    refetchInterval: DRAFT_SUMMARY_POLL_MS,
    enabled,
  });

  return {
    items: query.data?.sandboxes ?? [],
    totalPending: query.data?.totalPending ?? 0,
    isLoading: query.isLoading,
  };
};
