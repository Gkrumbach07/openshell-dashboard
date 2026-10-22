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
// The counts on the navigation, read by the shell on every page. The
// cross-workspace proposal count is one request to the BFF but one draft read
// per sandbox on the gateway, so the shell reads it at this pace on its own;
// a page that shows the same list keeps it at that list's pace while open.
export const NAV_COUNT_POLL_MS = 120_000;
// The Gateway page, where a platform admin lands and often leaves the tab
// open. Needs attention reads every sandbox on the gateway to find the ones
// in error, and the cross-workspace proposal summary, which is one draft read
// per sandbox on the gateway; both cost more the more sandboxes there are, so
// the page reads them at this pace rather than the Sandboxes and Proposals
// pages' own. The providers list only decides whether to say none exist yet.
export const GATEWAY_PAGE_POLL_MS = 30_000;
export const GATEWAY_PAGE_PROVIDERS_POLL_MS = 60_000;
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

// The commit this build is made from, shortened the way the image's sha-<7>
// tag shortens it, or '' when the build was not told. Injected by Vite's
// define (vite.config.ts) from DASHBOARD_COMMIT, which CI passes to the image
// build. A build does not know a version number: the image exists before any
// release is cut and is only given more tags afterwards.
declare const __DASHBOARD_COMMIT__: string;
export const BUILD_COMMIT = (
  typeof __DASHBOARD_COMMIT__ !== 'undefined' ? __DASHBOARD_COMMIT__ : ''
).slice(0, 7);
