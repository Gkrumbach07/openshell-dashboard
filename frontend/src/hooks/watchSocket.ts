import type { LogLine, Sandbox } from '../types';

// One JSON frame from the BFF's sandbox watch WebSocket (a relay of the
// gateway's WatchSandbox stream — see backend models.WatchEvent).
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

export const watchSocketUrl = (
  workspace: string,
  name: string,
  params?: URLSearchParams,
): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const search = params?.toString() ?? '';
  const query = search ? `?${search}` : '';
  return `${protocol}//${window.location.host}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/watch${query}`;
};

export type WatchSocketHandle = {
  dispose: () => void;
};

type WatchSocketOptions = {
  url: string;
  onEvent: (event: SandboxWatchEvent) => void;
  onLiveChange: (live: boolean) => void;
};

/**
 * Opens a WebSocket to `url` and keeps it alive: reconnects with capped,
 * jittered exponential backoff and gives up after repeated consecutive
 * failures. onLiveChange(true/false) tracks connection state so callers can
 * toggle their polling fallback. dispose() tears everything down.
 */
export const openWatchSocket = ({
  url,
  onEvent,
  onLiveChange,
}: WatchSocketOptions): WatchSocketHandle => {
  let ws: WebSocket | null = null;
  let disposed = false;
  let failures = 0;
  let reconnectTimer: number | undefined;

  const connect = () => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      failures = 0;
      onLiveChange(true);
    };

    ws.onmessage = (event) => {
      let parsed: SandboxWatchEvent;
      try {
        parsed = JSON.parse(event.data as string) as SandboxWatchEvent;
      } catch {
        return;
      }
      onEvent(parsed);
    };

    ws.onclose = () => {
      onLiveChange(false);
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

  return {
    dispose: () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
};
