---
name: add-page
description: Add a new page/view to OpenShell Dashboard. Creates the page component, route, navigation entry, and any needed API hooks. Use when adding a new view to the dashboard.
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
- Self-contained: takes props, loads its data through the `src/api/` hooks
- PatternFly 6 components only
- UI text through `useI18n` from `../i18n`, with the keys in a catalog under `frontend/src/i18n/locales/en/` (see `frontend/src/i18n/README.md`)
- Export as default
- Use relative imports (not `~/` alias)

For example, a page that shows one sandbox template:

```tsx
import {
  Alert,
  Bullseye,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { Link } from 'react-router-dom';

import { useTemplate } from '../api/templates';
import { useI18n } from '../i18n';

type TemplateDetailPageProps = {
  workspace: string;
  templateName: string;
};

const TemplateDetailPage: React.FC<TemplateDetailPageProps> = ({
  workspace,
  templateName,
}) => {
  const { t } = useI18n('workspaces');
  const template = useTemplate(workspace, templateName);

  if (template.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label={t('template.loading')} />
      </Bullseye>
    );
  }
  if (template.isError) {
    return (
      <Alert variant="danger" title={t('template.loadFailed')}>
        {(template.error as Error).message}
      </Alert>
    );
  }

  return (
    <PageSection>
      <Title headingLevel="h1" data-testid="template-name">
        {templateName}
      </Title>
      <Link to={`/workspaces/${workspace}`}>
        {t('template.backToWorkspace')}
      </Link>
    </PageSection>
  );
};

export default TemplateDetailPage;
```

The three `template.*` keys are new: add them to the catalog the page reads, here `frontend/src/i18n/locales/en/workspaces.ts`.

Key patterns:
- Navigate with `<Link>`; use `useNavigate` only for a redirect after an action
- `data-testid` on interactive elements
- No breadcrumbs in pages — the app shell adds its own

### 2. Add the route

Routes are defined in `frontend/src/app/AuthenticatedRoutes.tsx` inside the `<Routes>` block (not `AppRoutes.tsx`, which decides between the developer sign-in page, the session check and these routes). A page that takes props gets a small route wrapper in the same file, which reads the URL parameters, passes them on and adds the breadcrumbs:

```tsx
const TemplateDetailRoute: React.FC = () => {
  const { workspace, template } = useParams<{
    workspace: string;
    template: string;
  }>();
  if (!workspace || !template) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <WorkspaceCrumbs workspace={workspace} leaf={template} />
      <TemplateDetailPage workspace={workspace} templateName={template} />
    </>
  );
};
```

```tsx
<Route
  path="/workspaces/:workspace/templates/:template"
  element={<TemplateDetailRoute />}
/>
```

For admin-only pages, wrap with `AdminRoute`:

```tsx
<Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
```

### 3. Add navigation

A page under a workspace, like the one above, is reached from a link and gets no sidebar item. A top-level page gets one: the sidebar is rendered from the `navEntries` array in `frontend/src/app/AppLayout.tsx`, and a new item is one more entry. The Settings entry, for example:

```tsx
{
  path: '/settings',
  labelKey: 'nav.settings',
  adminOnly: true,
  featureKey: 'settings',
},
```

- `labelKey` is an i18n key. Add it to the `labelKey` union of the `NavEntry` type above the array, and add the label under `nav` in `frontend/src/i18n/locales/en/common.ts`.
- `adminOnly` shows the item to platform admins only.
- `featureKey` hides the item when that feature flag is off.

Hiding an item is not access control: the gateway decides what a user may do.

### 4. Add API hooks if needed

If the page needs data not yet wired up, use the `add-rpc` skill first.

### 5. Verify

```bash
make lint
make typecheck
make test
make dev  # verify in browser
```
