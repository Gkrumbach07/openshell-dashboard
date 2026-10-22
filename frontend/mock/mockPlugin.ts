// Vite dev-server plugin that intercepts /api calls and returns mock data.
// Activated when MOCK_API=true (set automatically by `make dev-mock`).

import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as data from './data';

type RouteHandler = (
  params: Record<string, string>,
  query: URLSearchParams,
) => unknown;

// MOCK_EMPTY=true serves a gateway nobody has used yet: the one `default`
// workspace it starts with, and nothing in it. That is what the Gateway
// page's get-started walkthrough stands in for, and it cannot be reached
// from the ordinary fixtures, which are deliberately full.
const isEmptyGateway = process.env.MOCK_EMPTY === 'true';

// A list as the gateway would answer it in whichever mode is running.
const orEmpty = <T>(items: T[]): T[] => (isEmptyGateway ? [] : items);

const emptyDraftSummary = { sandboxes: [], totalPending: 0 };

const workspaceDraftSummary = (workspace: string) =>
  (isEmptyGateway ? undefined : data.workspaceDraftSummary[workspace]) ??
  emptyDraftSummary;

// Route patterns: :param captures a path segment.
const routes: [string, RouteHandler][] = [
  // Auth
  ['GET /api/v1/auth/config', () => data.authConfig],
  ['GET /api/v1/auth/whoami', () => data.currentUser],

  // Gateway
  ['GET /api/v1/gateway', () => data.gatewayInfo],
  ['GET /api/v1/gateway/compatibility', () => data.gatewayCompatibility],

  // Workspaces
  [
    'GET /api/v1/workspaces',
    () => (isEmptyGateway ? data.workspaces.slice(0, 1) : data.workspaces),
  ],
  [
    'GET /api/v1/workspaces/:workspace',
    ({ workspace }) => data.workspaceDetail[workspace] ?? null,
  ],

  // Members
  [
    'GET /api/v1/workspaces/:workspace/members',
    ({ workspace }) => orEmpty(data.members[workspace] ?? []),
  ],

  // Providers (workspace scope)
  [
    'GET /api/v1/workspaces/:workspace/providers',
    ({ workspace }) => orEmpty(data.providers[workspace] ?? []),
  ],
  [
    'GET /api/v1/workspaces/:workspace/providers/:provider',
    ({ workspace, provider }) => {
      const list = data.providers[workspace] ?? [];
      return list.find((p) => p.metadata.name === provider) ?? null;
    },
  ],
  [
    'GET /api/v1/workspaces/:workspace/providers/:provider/refresh-status',
    ({ provider }) => data.refreshStatus[provider] ?? [],
  ],

  // Providers (all workspaces)
  ['GET /api/v1/providers', () => orEmpty(data.allProviders)],

  // Provider profiles (platform)
  ['GET /api/v1/provider-profiles', () => data.platformProfiles],
  // Provider profiles (workspace — includes platform's)
  [
    'GET /api/v1/workspaces/:workspace/provider-profiles',
    () => data.platformProfiles,
  ],

  // Sandboxes (workspace scope)
  [
    'GET /api/v1/workspaces/:workspace/sandboxes',
    ({ workspace }) => orEmpty(data.sandboxes[workspace] ?? []),
  ],
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox',
    ({ workspace, sandbox }) => {
      const list = data.sandboxes[workspace] ?? [];
      return list.find((s) => s.metadata.name === sandbox) ?? null;
    },
  ],

  // Sandbox logs
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/logs',
    ({ sandbox }) => data.sandboxLogs(sandbox),
  ],

  // Sandbox policy
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/policy',
    ({ workspace }) => data.sandboxPolicy(workspace),
  ],
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/policy/effective',
    () => data.effectivePolicy,
  ],

  // Sandbox settings
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/settings',
    () => data.sandboxSettings,
  ],

  // Sandbox providers (attached)
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/providers',
    ({ workspace, sandbox }) => data.attachedProviders(workspace, sandbox),
  ],

  // Sandbox services
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/services',
    ({ workspace, sandbox }) =>
      (data.services[workspace] ?? []).filter((s) => s.sandboxName === sandbox),
  ],

  // Sandbox drafts, filtered by ?status= as the BFF passes it to the gateway.
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/drafts',
    (_params, query) => {
      const status = query.get('status');
      return status
        ? {
            ...data.draftPolicy,
            chunks: data.draftPolicy.chunks.filter((c) => c.status === status),
          }
        : data.draftPolicy;
    },
  ],
  [
    'GET /api/v1/workspaces/:workspace/sandboxes/:sandbox/drafts/history',
    () => [],
  ],

  // Draft summaries. The scope is named, as the BFF reads it: ?workspace= is
  // one workspace's, ?allWorkspaces=true is every workspace's, and neither is
  // the empty answer the route has always given an unscoped poll.
  [
    'GET /api/v1/draft-summary',
    (_params, query) => {
      if (query.get('allWorkspaces') === 'true') {
        return isEmptyGateway ? emptyDraftSummary : data.draftSummary;
      }
      const workspace = query.get('workspace');
      return workspace ? workspaceDraftSummary(workspace) : emptyDraftSummary;
    },
  ],
  [
    'GET /api/v1/workspaces/:workspace/draft-summary',
    ({ workspace }) => workspaceDraftSummary(workspace),
  ],

  // Global policy
  ['GET /api/v1/global-policy', () => data.globalPolicy],

  // Global settings
  ['GET /api/v1/settings/global', () => data.globalSettings],

  // Templates (workspace scope)
  [
    'GET /api/v1/workspaces/:workspace/templates',
    ({ workspace }) => orEmpty(data.templates[workspace] ?? []),
  ],
  [
    'GET /api/v1/workspaces/:workspace/templates/:template',
    ({ workspace, template }) => {
      const list = data.templates[workspace] ?? [];
      return list.find((t) => t.metadata.name === template) ?? null;
    },
  ],

  // Templates (all workspaces)
  ['GET /api/v1/templates', () => orEmpty(data.allTemplates)],

  // Services (workspace scope)
  [
    'GET /api/v1/workspaces/:workspace/services',
    ({ workspace }) => orEmpty(data.services[workspace] ?? []),
  ],

  // Services (all workspaces)
  ['GET /api/v1/services', () => orEmpty(data.allServices)],

  // Sandboxes (all workspaces)
  ['GET /api/v1/sandboxes', () => orEmpty(data.allSandboxes)],
];

// Build a compiled router: convert :param patterns to regex.
type CompiledRoute = {
  method: string;
  regex: RegExp;
  paramNames: string[];
  handler: RouteHandler;
};

const compileRoutes = (): CompiledRoute[] =>
  routes.map(([pattern, handler]) => {
    const [method, path] = pattern.split(' ', 2);
    const paramNames: string[] = [];
    const regexStr = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    return {
      method,
      regex: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    };
  });

const matchRoute = (
  compiled: CompiledRoute[],
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null => {
  for (const route of compiled) {
    if (route.method !== method) continue;
    const match = pathname.match(route.regex);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { handler: route.handler, params };
  }
  return null;
};

// A list asked for with pageSize is answered a page at a time, as the BFF
// answers it: { items, nextPageToken }, the token being the next offset.
// Without pageSize the whole array is the answer, as before pagination.
const pageOf = (body: unknown, query: URLSearchParams): unknown => {
  const size = Number(query.get('pageSize'));
  if (!Array.isArray(body) || !query.has('pageSize') || !(size > 0)) {
    return body;
  }
  const offset = Number(query.get('pageToken') || '0');
  const next = offset + size;
  return {
    items: body.slice(offset, next),
    nextPageToken: next < body.length ? String(next) : '',
  };
};

const json = (res: ServerResponse, body: unknown, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export default function mockApiPlugin(): Plugin {
  const compiled = compileRoutes();
  return {
    name: 'mock-api',
    configureServer(server: ViteDevServer) {
      // Run before Vite's own middleware (including the proxy).
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const method = req.method ?? 'GET';
          const urlObj = new URL(req.url ?? '/', `http://${req.headers.host}`);
          const pathname = urlObj.pathname;

          // Only intercept /api paths.
          if (!pathname.startsWith('/api/')) {
            next();
            return;
          }

          // Handle write operations generically (POST/PUT/DELETE return a
          // sensible stub so the UI does not break on actions).
          if (method !== 'GET') {
            if (method === 'POST' || method === 'PUT') {
              json(res, { success: true, version: 1, policyHash: 'mock' });
            } else if (method === 'DELETE') {
              json(res, { deleted: true, outcome: 'completed' });
            } else {
              json(res, {}, 204);
            }
            return;
          }

          const result = matchRoute(compiled, method, pathname);
          if (!result) {
            json(
              res,
              {
                code: 'NOT_FOUND',
                message: `Mock: no handler for ${method} ${pathname}`,
              },
              404,
            );
            return;
          }

          const body = result.handler(result.params, urlObj.searchParams);
          if (body === null) {
            json(
              res,
              { code: 'NOT_FOUND', message: 'Resource not found' },
              404,
            );
            return;
          }
          json(res, pageOf(body, urlObj.searchParams));
        },
      );
    },
  };
}
