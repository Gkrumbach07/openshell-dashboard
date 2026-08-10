import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useFeatureFlags } from '../api/auth';
import { policyKeys, sandboxKeys } from '../api/queryKeys';
import type { LogLine, Sandbox } from '../types';

export type SandboxWatchEvent = {
  type: 'sandbox' | 'log' | 'warning' | 'draftPolicyUpdate';
  sandbox?: Sandbox;
  log?: LogLine;
  warning?: string;
  draftPolicyUpdate?: {
    draftVersion: number;
    newChunks: number;
    totalPending: number;
  };
};

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// After this many failed connects in a row, stop retrying — the proxy likely
// cannot upgrade WebSockets and polling has already taken over.
const MAX_CONSECUTIVE_FAILURES = 5;
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

    let ws: WebSocket | null = null;
    let disposed = false;
    let failures = 0;
    let reconnectTimer: number | undefined;
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

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/watch`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        failures = 0;
        setIsLive(true);
      };

      ws.onmessage = (event) => {
        let parsed: SandboxWatchEvent;
        try {
          parsed = JSON.parse(event.data as string) as SandboxWatchEvent;
        } catch {
          return;
        }
        if (parsed.type === 'sandbox' && parsed.sandbox) {
          queryClient.setQueryData(
            sandboxKeys.detail(workspace, name),
            parsed.sandbox,
          );
          invalidateSoon();
        } else if (
          parsed.type === 'draftPolicyUpdate' ||
          parsed.type === 'warning'
        ) {
          invalidateSoon();
        }
      };

      ws.onclose = () => {
        setIsLive(false);
        if (disposed) return;
        failures += 1;
        if (failures > MAX_CONSECUTIVE_FAILURES) return;
        const backoff = Math.min(
          RECONNECT_BASE_MS * 2 ** (failures - 1),
          RECONNECT_MAX_MS,
        );
        const delay = backoff * (0.5 + Math.random() * 0.5);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
      ws?.close();
      setIsLive(false);
    };
  }, [enabled, workspace, name, queryClient]);

  return { isLive };
};
