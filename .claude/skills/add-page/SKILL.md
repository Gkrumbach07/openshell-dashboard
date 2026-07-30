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

```
frontend/src/pages/<resource>/<PageName>.tsx
```

Rules:
- Self-contained: takes props, uses internal API hooks
- No `@odh-dashboard/*` imports — this must work standalone
- PatternFly 6 components only
- Export as default

```tsx
import React from 'react';
import { PageSection, Title } from '@patternfly/react-core';
import { useSandboxes } from '~/api/sandboxes';

type SandboxListPageProps = {
  workspace: string;
};

const SandboxListPage: React.FC<SandboxListPageProps> = ({ workspace }) => {
  const { data, isLoading, error } = useSandboxes(workspace);
  // ...
};

export default SandboxListPage;
```

### 2. Add the route

In `frontend/src/app/AppRoutes.tsx`:

```tsx
<Route path="/workspaces/:workspace/sandboxes" element={<SandboxListPage />} />
```

### 3. Add navigation

In the sidebar/navigation component, add the link with appropriate role gating.

### 4. Export for downstream

Add to `frontend/src/pages/index.ts`:

```tsx
export { default as SandboxListPage } from './sandboxes/SandboxListPage';
```

This allows downstream consumers to `import { SandboxListPage } from 'openshell-dashboard/pages'`.

### 5. Add API hooks if needed

If the page needs data not yet wired up, use the `add-rpc` skill first.

### 6. Verify

```bash
cd frontend && npm run typecheck && npm run test
make dev  # verify in browser
```
