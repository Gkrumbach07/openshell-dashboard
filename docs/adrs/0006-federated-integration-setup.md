# Federated Integration Setup (odh-dashboard)

How to integrate the OpenShell Dashboard into odh-dashboard (RHOAI) via module federation.

## Overview

The OpenShell Dashboard runs as a federated module inside the agent-ops package. The upstream repo is consumed as an npm package via `file:` protocol (dev) or published version (production). Wrapper components import self-contained pages, wrap them with providers, and register as extensions in the odh-dashboard plugin system.

**Working example:** The `openshell-npm-integration` branch in Gage's odh-dashboard fork demonstrates this end-to-end — OpenShell pages rendering inside RHOAI's Agents tab with live data from a gateway on ROSA.

## Prerequisites

- odh-dashboard repo cloned
- openshell-dashboard repo cloned and built (`cd frontend && npm run build:lib`)
- OpenShell gateway running (cluster or local)
- `oc login` to a cluster with RHOAI and the `agentOps` feature flag enabled

## Step 1: Add the npm dependency

In `packages/agent-ops/package.json`, add the openshell-dashboard dependency:

```json
{
  "dependencies": {
    "openshell-dashboard": "file:/path/to/openshell-dashboard/frontend"
  }
}
```

Then `npm install` from the monorepo root.

## Step 2: Configure webpack to resolve from source

In `packages/agent-ops/frontend/config/webpack.common.js`:

**Add webpack aliases** to resolve openshell-dashboard imports from source (avoids CSS/PF duplication issues with `dist/`):

```js
alias: {
  '~': path.resolve(SRC_DIR),
  '@odh-dashboard/internal': path.resolve(RELATIVE_DIRNAME, '../../../frontend/src'),
  'openshell-dashboard/pages': path.resolve(ROOT_NODE_MODULES, 'openshell-dashboard/src/pages/index.ts'),
  'openshell-dashboard/components': path.resolve(ROOT_NODE_MODULES, 'openshell-dashboard/src/components/index.ts'),
  'openshell-dashboard/api': path.resolve(ROOT_NODE_MODULES, 'openshell-dashboard/src/api/index.ts'),
  'openshell-dashboard/types': path.resolve(ROOT_NODE_MODULES, 'openshell-dashboard/src/types/index.ts'),
  'openshell-dashboard/slots': path.resolve(ROOT_NODE_MODULES, 'openshell-dashboard/src/slots/index.ts'),
},
```

**Add ts-loader exception** so openshell-dashboard source gets compiled:

```js
exclude: [/node_modules\/(?!@odh-dashboard|openshell-dashboard)/, /__tests__/, /__mocks__/],
```

**Add CSS rule** for openshell-dashboard's custom CSS:

```js
{ test: /\.css$/, use: ['style-loader', 'css-loader'] },
```

**Add modules resolution** so PF resolves from the monorepo, not openshell-dashboard's own node_modules:

```js
modules: [
  path.resolve(SRC_DIR),
  path.resolve(RELATIVE_DIRNAME, 'node_modules'),
  ROOT_NODE_MODULES,
  'node_modules',
],
```

## Step 3: Add the BFF proxy

In `packages/agent-ops/package.json`, add a proxy entry in the `module-federation` config:

```json
{
  "module-federation": {
    "proxy": [
      { "path": "/openshell/api", "pathRewrite": "/api" }
    ]
  }
}
```

This routes `/openshell/api/*` to the OpenShell BFF on the configured port.

## Step 4: Create wrapper components

Create `packages/agent-ops/frontend/src/odh/openshell/` with:

**OpenShellProviders.tsx** — wraps pages with QueryClient, SlotProvider, AlertProvider, and calls `setApiBasePath('/openshell')` + `setSessionExpiredHandler`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertProvider } from 'openshell-dashboard/components';
import { SlotProvider } from 'openshell-dashboard/slots';
import { setApiBasePath, setSessionExpiredHandler } from 'openshell-dashboard/api';

setApiBasePath('/openshell');
setSessionExpiredHandler(() => { window.location.assign('/'); });

const OpenShellProviders = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <SlotProvider slots={{}}>
      <AlertProvider>{children}</AlertProvider>
    </SlotProvider>
  </QueryClientProvider>
);
```

**WorkspacesWrapper.tsx** — imports `WorkspaceListPage`, maps navigation to odh-dashboard routes:

```tsx
import { WorkspaceListPage } from 'openshell-dashboard/pages';

const WorkspacesWrapper = () => {
  const navigate = useNavigate();
  return (
    <OpenShellProviders>
      <WorkspaceListPage onSelect={(name) => navigate(`/ai-hub/agents/workspaces/${name}`)} />
    </OpenShellProviders>
  );
};
```

Similarly for `WorkspaceDetailWrapper`, `SandboxDetailWrapper`, `ProviderDetailWrapper` — each imports the upstream page, wraps with providers, and maps navigation callbacks.

## Step 5: Register extensions

In `packages/agent-ops/extensions.ts` (build-time discovery, NOT the inner `frontend/src/odh/extensions.ts`):

```ts
import type { AreaExtension, RouteExtension, TabRouteTabExtension } from '@odh-dashboard/plugin-core/extension-points';

const extensions = [
  { type: 'app.area', properties: { id: 'agent-ops', featureFlags: ['agentOps'] } },
  { type: 'app.tab-route/tab', flags: { required: ['agent-ops'] },
    properties: { pageId: 'agents-tab-page', id: 'deployments', title: 'Deployments',
      component: () => import('./frontend/src/odh/openshell/WorkspacesWrapper'), group: '1_deployments' } },
  { type: 'app.route', flags: { required: ['agent-ops'] },
    properties: { path: '/ai-hub/agents/workspaces/:workspace',
      component: () => import('./frontend/src/odh/openshell/WorkspaceDetailWrapper') } },
  // ... sandbox detail, provider detail routes
];
```

Extensions must be in the **outer** `extensions.ts` (not `frontend/src/odh/extensions.ts`) to be discovered at build time. Runtime MF loading requires the agent-ops frontend dev server running separately.

## Step 6: Start the BFF

The OpenShell BFF must be running on the port configured in the proxy (default 9111):

```bash
cd openshell-dashboard/backend
PORT=9111 AUTH_DISABLED=true go run ./cmd/server/
```

With a gateway port-forward:

```bash
oc port-forward -n openshell pod/openshell-0 50051:8080
```

## Step 7: Run odh-dashboard

```bash
# Create .env.local with cluster config
echo 'APP_ENV=local
OC_PROJECT=redhat-ods-applications' > .env.local

# Start the dashboard
npm run dev
```

Navigate to **AI hub > Agents** — the Deployments tab renders the OpenShell WorkspaceListPage inside RHOAI.

## Auth in federated mode

The BFF reads tokens from two headers:
- `x-forwarded-access-token` (kube-auth-proxy in production)
- `Authorization: Bearer` (standalone/dev fallback)

No OIDC configuration needed on the BFF in federated mode — the proxy handles authentication. The BFF forwards whatever token it receives to the gateway.

For the gateway to validate the token and enforce its RBAC, the cluster should have an external OIDC provider configured (Keycloak/Entra ID) so tokens are JWTs. See ADR 0005 for the credential bridge gap with default OpenShift OAuth.
