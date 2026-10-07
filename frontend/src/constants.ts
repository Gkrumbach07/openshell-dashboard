// Polling intervals (ms) — how often React Query refetches live data.
//
// React Query runs an interval only while the page is visible
// (refetchIntervalInBackground is off unless a query turns it on), so a tab
// left in the background asks the BFF for nothing. The upstream TUI re-reads
// everything every two seconds; every interval here is slower than that,
// because a page in a browser is read far more often than what it shows
// changes.
export const SANDBOX_POLL_MS = 5_000;
export const DRAFT_POLL_MS = 10_000;
export const DRAFT_SUMMARY_POLL_MS = 15_000;
export const GATEWAY_POLL_MS = 30_000;
// A policy revision that is waiting for its sandbox to load it. This is the
// one thing a user sits and watches, so it keeps the TUI's pace.
export const POLICY_PENDING_POLL_MS = 2_000;
// Lists and details that change when somebody changes them: workspaces,
// members, sandbox templates, service endpoints, and the lists across
// workspaces other than the sandboxes.
export const RESOURCE_POLL_MS = 15_000;
// Configuration: the gateway's settings and global policy, and a sandbox's
// settings and policy once no revision is pending. Changed rarely, and by few.
export const CONFIG_POLL_MS = 30_000;

// React Query stale-time presets (ms).
export const STALE_5_MIN = 5 * 60 * 1000;

// UI dimensions.
export const TAB_CONTENT_HEIGHT = 500;
export const DEFAULT_LOG_LINES = '200';

// Terminal theme — used by xterm.js.
export const TERMINAL_FONT_SIZE = 14;

// Route paths.
export const ROUTES = {
  LOGIN: '/login',
  AUTH_CALLBACK: '/auth/callback',
} as const;

// Container image registry.
export const COMMUNITY_REGISTRY =
  'ghcr.io/nvidia/openshell-community/sandboxes';

// Dashboard version — injected by Vite define in vite.config.ts.
declare const __APP_VERSION__: string;
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';
