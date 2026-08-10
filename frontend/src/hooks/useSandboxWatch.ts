import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useFeatureFlags } from '../api/auth';
import { policyKeys, sandboxKeys } from '../api/queryKeys';
import { openWatchSocket, watchSocketUrl } from './watchSocket';

export type { SandboxWatchEvent } from './watchSocket';

// Gateway watch-bus events can burst (one per draft mutation); coalesce
// refetches into one.
const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Subscribes to the BFF's sandbox watch WebSocket (a relay of the gateway's
 * WatchSandbox stream) and translates events into React Query cache updates:
 * sandbox snapshots are pushed directly into the detail cache, and draft /
 * policy queries are invalidated so they refetch.
 *
 * Returns isLive so callers can switch their queries' refetchInterval off
 * while the socket is open — polling is the fallback, not a parallel system.
 * When the liveUpdates feature flag is off, no socket is opened and isLive
 * stays false.
 */
export const useSandboxWatch = (
  workspace: string,
  name: string,
): { isLive: boolean } => {
  const flags = useFeatureFlags();
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(false);
  const enabled = !!flags.liveUpdates;

  useEffect(() => {
    if (!enabled) return undefined;

    let invalidateTimer: number | undefined;

    const invalidateSoon = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        queryClient.invalidateQueries({
          queryKey: policyKeys.drafts(workspace, name),
        });
        queryClient.invalidateQueries({
          queryKey: policyKeys.sandbox(workspace, name),
        });
        queryClient.invalidateQueries({
          queryKey: policyKeys.draftHistory(workspace, name),
        });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const handle = openWatchSocket({
      url: watchSocketUrl(workspace, name),
      onEvent: (event) => {
        if (event.type === 'sandbox' && event.sandbox) {
          queryClient.setQueryData(
            sandboxKeys.detail(workspace, name),
            event.sandbox,
          );
          invalidateSoon();
        } else if (
          event.type === 'draftPolicyUpdate' ||
          event.type === 'warning'
        ) {
          invalidateSoon();
        }
      },
      onLiveChange: setIsLive,
    });

    return () => {
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
      handle.dispose();
      setIsLive(false);
    };
  }, [enabled, workspace, name, queryClient]);

  return { isLive };
};
