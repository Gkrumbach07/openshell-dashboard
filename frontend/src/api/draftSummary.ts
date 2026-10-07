import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { DRAFT_SUMMARY_POLL_MS } from '../constants';
import { get } from './client';
import { policyKeys } from './queryKeys';
import type { DraftSandboxSummary, DraftSummary } from '../types';

// The pending draft chunks of every sandbox in a workspace, which is what the
// "N pending" badge beside a sandbox in the list is read from. The BFF builds
// it from one draft read per sandbox, the way the TUI does.
export const getWorkspaceDraftSummary = (
  workspace: string,
): Promise<DraftSummary> =>
  get<DraftSummary>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/draft-summary`,
  );

// bySandbox holds an entry for each sandbox that has pending chunks or whose
// inbox could not be read (`unavailable`). A sandbox without one has none
// pending. Pass enabled=false where draft policies are switched off: nothing
// is requested and every sandbox reads as having none.
export const useWorkspaceDraftSummary = (workspace: string, enabled = true) => {
  const query = useQuery({
    queryKey: policyKeys.workspaceDraftSummary(workspace),
    queryFn: () => getWorkspaceDraftSummary(workspace),
    refetchInterval: DRAFT_SUMMARY_POLL_MS,
    enabled,
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
