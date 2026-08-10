import { useEffect, useMemo, useState } from 'react';

import { useFeatureFlags } from '../api/auth';
import { openWatchSocket, watchSocketUrl } from './watchSocket';
import type { LogLine } from '../types';

export type LogStreamFilters = {
  lines: number;
  level?: string;
  sources?: string[];
};

/**
 * Streams sandbox log lines over the watch WebSocket (follow_logs): the BFF
 * replays the last `lines` as a tail, then pushes live lines. The buffer is
 * capped at `lines` so it mirrors the polled view's line-count selector.
 *
 * Returns isStreaming so the caller can suspend its polled logs query while
 * the stream is healthy — like useSandboxWatch, polling is the fallback.
 * Disabled entirely (no socket) when `enabled` is false or the liveUpdates
 * feature flag is off.
 */
export const useSandboxLogStream = (
  workspace: string,
  name: string,
  filters: LogStreamFilters,
  enabled: boolean,
): { lines: LogLine[]; isStreaming: boolean } => {
  const flags = useFeatureFlags();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const active = enabled && !!flags.liveUpdates;

  const { lines: maxLines, level } = filters;
  const sourcesKey = (filters.sources ?? []).join(',');

  const params = useMemo(() => {
    const search = new URLSearchParams({ logs: 'true' });
    search.set('lines', String(maxLines));
    if (level) search.set('level', level);
    for (const source of sourcesKey.split(',')) {
      if (source) search.append('source', source);
    }
    return search.toString();
  }, [maxLines, level, sourcesKey]);

  useEffect(() => {
    if (!active) return undefined;
    setLines([]);

    const handle = openWatchSocket({
      url: watchSocketUrl(workspace, name, new URLSearchParams(params)),
      onEvent: (event) => {
        if (event.type !== 'log' || !event.log) return;
        const line = event.log;
        setLines((prev) => {
          const next = [...prev, line];
          return next.length > maxLines
            ? next.slice(next.length - maxLines)
            : next;
        });
      },
      onLiveChange: (live) => {
        // Each (re)connect replays the tail, so reset the buffer to avoid
        // duplicating replayed lines.
        if (live) setLines([]);
        setIsStreaming(live);
      },
    });

    return () => {
      handle.dispose();
      setIsStreaming(false);
    };
  }, [active, workspace, name, params, maxLines]);

  return { lines, isStreaming };
};
