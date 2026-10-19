import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import { DRAFT_SUMMARY_POLL_MS } from '../constants';
import { get } from './client';
import { allWorkspacesKeys, policyKeys } from './queryKeys';
import type { DraftSandboxSummary, DraftSummary } from '../types';

// The pending draft chunks of every sandbox in a workspace, which is what the
// "N pending" badge beside a sandbox in the list is read from. The BFF builds
// it from one draft read per sandbox, the way the TUI does.
export const getWorkspaceDraftSummary = (
  workspace: string,
  names?: readonly string[],
): Promise<DraftSummary> => {
  const path = `/api/v1/workspaces/${encodeURIComponent(workspace)}/draft-summary`;
  if (!names) return get<DraftSummary>(path);
  if (names.length === 0)
    return Promise.resolve({ sandboxes: [], totalPending: 0 });
  const params = new URLSearchParams();
  names.forEach((name) => params.append('sandbox', name));
  return get<DraftSummary>(`${path}?${params.toString()}`);
};

// bySandbox holds an entry for each sandbox that has pending chunks or whose
// inbox could not be read (`unavailable`). A sandbox without one has none
// pending. Pass enabled=false where draft policies are switched off: nothing
// is requested and every sandbox reads as having none.
export const useWorkspaceDraftSummary = (
  workspace: string,
  enabled = true,
  names?: readonly string[],
) => {
  const query = useQuery({
    queryKey: policyKeys.workspaceDraftSummary(workspace, names),
    queryFn: () => getWorkspaceDraftSummary(workspace, names),
    refetchInterval: DRAFT_SUMMARY_POLL_MS,
    enabled: enabled && (names === undefined || names.length > 0),
  });

  const items = query.data?.sandboxes;
  const bySandbox = useMemo(() => {
    const map: Record<string, DraftSandboxSummary> = {};
    for (const item of items ?? []) {
      map[item.sandboxName] = item;
    }
    return map;
  }, [items]);

  return {
    items: items ?? [],
    bySandbox,
    totalPending: query.data?.totalPending ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
  };
};

// The same summary across every workspace, in one request. The gateway
// answers an all-workspaces list for platform admins only and refuses
// everyone else, so this is for a caller that knows it is one; the Proposals
// page reads each workspace separately otherwise. The scope is named: the
// same route without it answers empty, for embedders that still poll it.
export const getAllWorkspacesDraftSummary = (): Promise<DraftSummary> =>
  get<DraftSummary>('/api/v1/draft-summary?allWorkspaces=true');

// `refetchInterval` is for the shell, which counts on every page and reads
// at NAV_COUNT_POLL_MS, and for the Gateway page (GATEWAY_PAGE_POLL_MS); the
// Proposals page leaves it alone.
export const useAllWorkspacesDraftSummary = (
  enabled = true,
  options: { refetchInterval?: number } = {},
) => {
  const query = useQuery({
    queryKey: allWorkspacesKeys.draftSummary,
    queryFn: getAllWorkspacesDraftSummary,
    refetchInterval: options.refetchInterval ?? DRAFT_SUMMARY_POLL_MS,
    enabled,
  });

  return {
    items: query.data?.sandboxes ?? [],
    totalPending: query.data?.totalPending ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

// The summaries of the named workspaces, one request each, merged in the
// order the workspaces were given. This is how a user who is not a platform
// admin reads across the workspaces they are in: the gateway refuses them the
// all-workspaces list, but each workspace they are a member of is theirs to
// read. A workspace whose summary fails is counted as one that could not be
// read, not as one with nothing pending.
export const useWorkspacesDraftSummaries = (
  workspaces: string[],
  enabled = true,
) => {
  const queries = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: policyKeys.workspaceDraftSummary(workspace),
      queryFn: () => getWorkspaceDraftSummary(workspace),
      refetchInterval: DRAFT_SUMMARY_POLL_MS,
      enabled,
    })),
  });

  // useQueries returns a new array every render, so the merge is keyed on
  // what actually changed: each query's status (pending, error or success),
  // when it last produced data, and when it last failed. The status is in
  // the key so that the render on which the reads start, after a render
  // with them disabled, is not answered from that disabled render.
  const fingerprint = queries
    .map(
      (query) =>
        `${query.status}:${query.fetchStatus}:${query.dataUpdatedAt}:${query.errorUpdatedAt}`,
    )
    .join(',');

  return useMemo(() => {
    const items: DraftSandboxSummary[] = [];
    const failed: string[] = [];
    let totalPending = 0;
    queries.forEach((query, i) => {
      if (query.isError) {
        failed.push(workspaces[i]);
        return;
      }
      items.push(...(query.data?.sandboxes ?? []));
      totalPending += query.data?.totalPending ?? 0;
    });
    return {
      items,
      totalPending,
      // Loading until every workspace has answered, one way or the other: a
      // list built from some of them would say "nothing waiting" about the
      // ones still being read. A read that is switched off is not loading.
      isLoading: enabled && queries.some((query) => query.isPending),
      // Only a user with no readable workspace at all has no list; one
      // workspace that failed is a gap in it, named by `failedWorkspaces`.
      isError: queries.length > 0 && failed.length === queries.length,
      error: queries.find((query) => query.isError)?.error,
      failedWorkspaces: failed,
      refetch: () => queries.forEach((query) => void query.refetch()),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, enabled, workspaces.join(',')]);
};
