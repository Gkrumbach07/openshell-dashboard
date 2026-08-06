---
name: add-page
description: Add a new page/view to the OpenShell Dashboard. Creates the page component, route, navigation entry, and any needed API hooks. Use when adding a new view to the dashboard.
---

# Add Page

Add a new page to the dashboard frontend.

## Arguments

`$ARGUMENTS` — Page name and description (e.g., "sandbox detail page showing overview, logs, and connect tabs")

## Steps

### 1. Create the page component

Pages are flat files in `frontend/src/pages/` (no subdirectories):

```
frontend/src/pages/<PageName>.tsx
```

Rules:
- Self-contained: takes props, uses internal API hooks
- No `@odh-dashboard/*` imports — this must work standalone
- PatternFly 6 components only
- Export as default
- Use relative imports (not `~/` alias)

```tsx
import { useState } from 'react';
import { PageSection, Title } from '@patternfly/react-core';
import { useSandboxes } from '../api/sandboxes';
import { sandboxKeys } from '../api/queryKeys';

type SandboxListPageProps = {
  workspace: string;
  onSelect?: (name: string) => void;
};

const SandboxListPage: React.FC<SandboxListPageProps> = ({ workspace, onSelect }) => {
  const { data, isLoading, error } = useSandboxes(workspace);

  const handleSelect = (name: string) => {
    if (onSelect) {
      onSelect(name);
    } else {
      navigate(`/workspaces/${workspace}/sandboxes/${name}`);
    }
  };

  // ...
};

export default SandboxListPage;
```

Key patterns:
- Optional navigation callbacks (`onSelect`, `onViewSandbox`, `onTabChange`) that fall back to `useNavigate` when not provided (see ADR 0004)
- `data-testid` on interactive elements
- No breadcrumbs in pages — the app shell adds its own

### 2. Add the route

Routes are defined in `frontend/src/app/App.tsx` inside the `AuthenticatedApp` component's `<Routes>` block (not `AppRoutes` — that handles auth mode switching):

```tsx
<Route path="/workspaces/:workspace/sandboxes" element={<SandboxListPage />} />
```

For admin-only pages, wrap with `AdminRoute`:

```tsx
<Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
```

### 3. Add navigation

In `frontend/src/app/AppLayout.tsx`, add a `NavItem` to the sidebar with appropriate role gating:

```tsx
<NavItem isActive={location.pathname === '/settings'}>
  <Link to="/settings">Settings</Link>
</NavItem>
```

### 4. Export for downstream

Add to `frontend/src/pages/index.ts`:

```tsx
export { default as SandboxListPage } from './SandboxListPage';
```

This allows downstream consumers to `import { SandboxListPage } from 'openshell-dashboard/pages'`.

### 5. Add API hooks if needed

If the page needs data not yet wired up, use the `add-rpc` skill first.

### 6. Verify

```bash
make lint
make typecheck
make test
make dev  # verify in browser
```
