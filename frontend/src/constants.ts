// Polling intervals (ms) — how often React Query refetches live data.
export const SANDBOX_POLL_MS = 5_000;
export const DRAFT_POLL_MS = 10_000;
export const DRAFT_SUMMARY_POLL_MS = 15_000;
export const GATEWAY_POLL_MS = 30_000;

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
