import { useMemo, useRef } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  CONFIG_POLL_MS,
  DRAFT_POLL_MS,
  DRAFT_SUMMARY_POLL_MS,
  POLICY_PENDING_POLL_MS,
} from '../constants';
import { apiFetch, del, get, post, put } from './client';
import { policyKeys, sandboxKeys } from './queryKeys';
import type {
  ApproveAllResult,
  DraftChunkApproval,
  DraftHistoryEntry,
  DraftPolicy,
  DraftSummary,
  EffectivePolicy,
  NetworkPolicyRule,
  PolicyMergeOperation,
  PolicyRevision,
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

// Incremental changes, applied by the gateway to the sandbox's latest policy
// (what `openshell policy update` sends). Nothing but the operations travels,
// so a rule they do not name cannot be changed by the round trip.
export const mergeSandboxPolicy = (
  workspace: string,
  name: string,
  operations: PolicyMergeOperation[],
): Promise<PolicyUpdateResult> =>
  post<PolicyUpdateResult>(`${sandboxBase(workspace, name)}/policy/merge`, {
    operations,
  });

export const getEffectiveSandboxPolicy = (
  workspace: string,
  name: string,
): Promise<EffectivePolicy> =>
  get<EffectivePolicy>(`${sandboxBase(workspace, name)}/policy/effective`);

export const getSandboxPolicyRevision = (
  workspace: string,
  name: string,
  version: number,
): Promise<PolicyRevision> =>
  get<PolicyRevision>(
    `${sandboxBase(workspace, name)}/policy/revisions/${version}`,
  );

export const getGlobalPolicy = (): Promise<SandboxPolicyView> =>
  get<SandboxPolicyView>('/api/v1/global-policy');

export const getGlobalPolicyRevision = (
  version: number,
): Promise<PolicyRevision> =>
  get<PolicyRevision>(`/api/v1/global-policy/revisions/${version}`);

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
  reviewToken?: string,
): Promise<PolicyUpdateResult> =>
  post<PolicyUpdateResult>(
    `${sandboxBase(workspace, name)}/drafts/${encodeURIComponent(chunkId)}/approve`,
    reviewToken ? { reviewToken } : {},
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

// approvals names the chunks the reviewer saw, each with its review token. The
// gateway skips a chunk approved without the token it carries, so send them
// whenever the chunks are at hand; without any, the BFF approves whatever is
// pending when the request arrives.
export const approveAllDraftChunks = (
  workspace: string,
  name: string,
  includeSecurityFlagged: boolean,
  approvals?: DraftChunkApproval[],
): Promise<ApproveAllResult> =>
  post<ApproveAllResult>(
    `${sandboxBase(workspace, name)}/drafts/approve-all`,
    approvals?.length
      ? { includeSecurityFlagged, approvals }
      : { includeSecurityFlagged },
  );

// How long a view watches a pending revision at the fast pace. It is the
// default `--timeout` of `openshell policy set --wait` and `policy update
// --wait` (60 seconds): a revision the sandbox has not loaded by then is one
// the CLI stops waiting for too. A sandbox that is stopped, or stuck, never
// loads its revision, and each read of a sandbox's policy costs the gateway
// one call per revision, so the fast pace must not go on for as long as the
// page is open.
export const POLICY_PENDING_WATCH_MS = 60_000;

// The pace a sandbox's policy is re-read at. `pendingForMs` is how long the
// view has been watching the latest revision wait to be loaded, and undefined
// when that revision is not waiting.
export const sandboxPolicyPollMs = (
  pendingForMs: number | undefined,
): number =>
  pendingForMs !== undefined && pendingForMs < POLICY_PENDING_WATCH_MS
    ? POLICY_PENDING_POLL_MS
    : CONFIG_POLL_MS;

// Re-reads quickly while the latest revision is PENDING, so the view settles
// on LOADED or FAILED by itself (what `--wait` does on the CLI), for as long
// as the CLI would wait: see POLICY_PENDING_WATCH_MS. After that, and
// whenever no revision is pending, it is still re-read, slowly: a revision
// that loads late, one somebody else adds, or a proposal approved on another
// page, shows up without a reload.
//
// The wait is timed from when this view first saw the revision pending, on
// the browser's clock alone. The revision's own creation time is the
// gateway's, and a browser clock that disagrees with it would cut the watch
// short or stretch it.
export const useSandboxPolicy = (workspace: string, name: string) => {
  const watched = useRef<{ revision: string; sinceMs: number } | null>(null);
  return useQuery({
    queryKey: policyKeys.sandbox(workspace, name),
    queryFn: () => getSandboxPolicy(workspace, name),
    refetchInterval: (query) => {
      const latest = query.state.data?.latest;
      if (latest?.status !== 'PENDING') {
        watched.current = null;
        return sandboxPolicyPollMs(undefined);
      }
      const revision = `${workspace}/${name}#${latest.version}`;
      if (watched.current?.revision !== revision) {
        watched.current = { revision, sinceMs: Date.now() };
      }
      return sandboxPolicyPollMs(Date.now() - watched.current.sinceMs);
    },
  });
};

// Polled with the policy it is derived from. A gateway-global policy that is
// set or deleted changes this for every sandbox, and so does a provider that
// is attached or detached.
export const useEffectiveSandboxPolicy = (workspace: string, name: string) =>
  useQuery({
    queryKey: policyKeys.effective(workspace, name),
    queryFn: () => getEffectiveSandboxPolicy(workspace, name),
    refetchInterval: CONFIG_POLL_MS,
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

export const useMergeSandboxPolicy = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (operations: PolicyMergeOperation[]) =>
      mergeSandboxPolicy(workspace, name, operations),
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

// Polled: another platform admin, or the CLI, may set or delete the global
// policy while the page is open.
export const useGlobalPolicy = () =>
  useQuery({
    queryKey: policyKeys.global,
    queryFn: getGlobalPolicy,
    refetchInterval: CONFIG_POLL_MS,
  });

// The global policy replaces the policy of every sandbox, so setting or
// deleting it changes each sandbox's policy view and effective policy, and
// the policy source its settings report.
const invalidateGlobalPolicy = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: policyKeys.global }),
    queryClient.invalidateQueries({ queryKey: policyKeys.allSandboxes }),
    queryClient.invalidateQueries({ queryKey: sandboxKeys.allSettings }),
  ]);

// One global revision with its payload. The global listing carries payloads
// for the newest revision only, so an older one is read when it is opened.
export const useGlobalPolicyRevision = (version: number, enabled = true) =>
  useQuery({
    queryKey: policyKeys.globalRevision(version),
    queryFn: () => getGlobalPolicyRevision(version),
    enabled: enabled && version > 0,
  });

export const useSetGlobalPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setGlobalPolicy,
    onSuccess: () => invalidateGlobalPolicy(queryClient),
  });
};

export const deleteGlobalPolicy = (): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>('/api/v1/global-policy');

export const useDeleteGlobalPolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteGlobalPolicy,
    onSuccess: () => invalidateGlobalPolicy(queryClient),
  });
};

// status narrows the inbox to "pending", "approved" or "rejected"
// (`openshell draft get --status`); without it every chunk is returned.
export const useDraftPolicy = (
  workspace: string,
  name: string,
  status?: string,
) =>
  useQuery({
    queryKey: policyKeys.drafts(workspace, name, status),
    queryFn: () => getDraftPolicy(workspace, name, status),
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
      queryClient.invalidateQueries({
        queryKey: policyKeys.drafts(workspace, name),
      });
      queryClient.invalidateQueries({
        queryKey: policyKeys.draftHistory(workspace, name),
      });
      queryClient.invalidateQueries({
        queryKey: policyKeys.sandbox(workspace, name),
      });
    },
  });
};

export const useApproveDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(
    workspace,
    name,
    (args: { chunkId: string; reviewToken?: string }) =>
      approveDraftChunk(workspace, name, args.chunkId, args.reviewToken),
  );

export const useRejectDraftChunk = (workspace: string, name: string) =>
  useDraftMutation(
    workspace,
    name,
    ({ chunkId, reason }: { chunkId: string; reason?: string }) =>
      rejectDraftChunk(workspace, name, chunkId, reason),
  );

// Takes the bare flag, as it always has, or the flag together with the
// approvals to send.
export const useApproveAllDraftChunks = (workspace: string, name: string) =>
  useDraftMutation(
    workspace,
    name,
    (
      args:
        | boolean
        | { includeSecurityFlagged: boolean; approvals?: DraftChunkApproval[] },
    ) =>
      typeof args === 'boolean'
        ? approveAllDraftChunks(workspace, name, args)
        : approveAllDraftChunks(
            workspace,
            name,
            args.includeSecurityFlagged,
            args.approvals,
          ),
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

// The route outside a workspace. With a workspace it is that workspace's
// summary. Without one the BFF answers an empty summary, as it did before
// there was a real one: it is kept for embedders that still poll it. A page
// reads one workspace's pending chunks with useWorkspaceDraftSummary
// (draftSummary.ts).
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
