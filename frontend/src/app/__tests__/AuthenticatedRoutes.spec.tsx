import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type MockRole = {
  isPlatformAdmin: boolean;
  isUser: boolean;
  isUnentitled: boolean;
  isLoading: boolean;
};

const entitledUser = (): MockRole => ({
  isPlatformAdmin: false,
  isUser: true,
  isUnentitled: false,
  isLoading: false,
});

let mockRole: MockRole = entitledUser();
jest.mock('../../api/rbac', () => ({
  useUserRole: () => mockRole,
}));

// The shell and the pages are not what is under test: only which page a path
// leads to, and for whom.
jest.mock('../AppLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const mockPage = (testId: string) => ({
  __esModule: true,
  default: () => <div data-testid={testId} />,
});
jest.mock('../../pages/AllSandboxesPage', () => mockPage('sandboxes'));
jest.mock('../../pages/AllWorkspacesPage', () => mockPage('all-workspaces'));
jest.mock('../../pages/EntitlementPage', () => mockPage('entitlement-screen'));
jest.mock('../../pages/GatewayOverviewPage', () => mockPage('gateway'));
jest.mock('../../pages/WorkspaceListPage', () => mockPage('workspace-list'));
jest.mock('../../pages/WorkspaceDetailPage', () => mockPage('workspace'));
jest.mock('../../pages/SandboxDetailPage', () => mockPage('sandbox'));
jest.mock('../../pages/ProviderDetailPage', () => mockPage('provider'));
jest.mock('../../pages/GlobalPolicyPage', () => mockPage('global-policy'));
jest.mock('../../pages/SettingsPage', () => mockPage('settings'));

import AuthenticatedRoutes from '../AuthenticatedRoutes';

const renderAt = (route: string) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthenticatedRoutes />
    </MemoryRouter>,
  );

describe('AuthenticatedRoutes', () => {
  beforeEach(() => {
    mockRole = entitledUser();
  });

  // The gateway answers the lists across workspaces for platform admins
  // only. The route does not decide that: it just does not send anyone else
  // to a page that could only show them a refusal.
  it('shows the all-workspaces page to a platform admin', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };
    renderAt('/all-workspaces');

    expect(screen.getByTestId('all-workspaces')).toBeInTheDocument();
  });

  it('sends anyone else to their workspaces instead', () => {
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });

  it('shows the sandboxes page to a platform admin', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };
    renderAt('/sandboxes');

    expect(screen.getByTestId('sandboxes')).toBeInTheDocument();
  });

  it('sends anyone else away from sandboxes', () => {
    renderAt('/sandboxes');

    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });

  it('decides nothing while the role is still loading', () => {
    mockRole = { ...entitledUser(), isLoading: true };
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list')).not.toBeInTheDocument();
  });

  // Breadcrumb puts the divider on each child after the first, and it counts
  // its children without looking inside a fragment. Grouping the deeper two
  // in one left a sandbox's trail reading "Workspaces default sb" with
  // nothing between the names.
  it('divides every crumb of a sandbox from the one before it', () => {
    const { container } = renderAt('/workspaces/team-a/sandboxes/sb');

    const crumbs = screen.getAllByRole('listitem');
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual([
      'Workspaces',
      'team-a',
      'sb',
    ]);
    expect(
      container.querySelectorAll('.pf-v6-c-breadcrumb__item-divider'),
    ).toHaveLength(2);
  });

  // It sits beside /workspaces, not under it: a workspace named
  // "all-workspaces" would otherwise be shadowed, and the reverse.
  it('keeps the workspace routes where they were', () => {
    mockRole = { ...entitledUser(), isPlatformAdmin: true };

    const { unmount } = renderAt('/workspaces');
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
    unmount();

    const { unmount: unmountAllWorkspaces } = renderAt(
      '/workspaces/all-workspaces',
    );
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    unmountAllWorkspaces();

    // Beside /workspaces, not under it: a workspace named "sandboxes" is
    // still that workspace, and a sandbox detail path is still a sandbox.
    const { unmount: unmountWorkspace } = renderAt('/workspaces/sandboxes');
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
    unmountWorkspace();

    renderAt('/workspaces/team-a/sandboxes/agent');
    expect(screen.getByTestId('sandbox')).toBeInTheDocument();
    expect(screen.queryByTestId('sandboxes')).not.toBeInTheDocument();
  });

  it('shows the entitlement screen instead of routes when unentitled', () => {
    mockRole = {
      isPlatformAdmin: false,
      isUser: false,
      isUnentitled: true,
      isLoading: false,
    };
    renderAt('/workspaces');

    expect(screen.getByTestId('entitlement-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list')).not.toBeInTheDocument();
  });

  it('does not treat a missing whoami as unentitled', () => {
    mockRole = {
      isPlatformAdmin: false,
      isUser: false,
      isUnentitled: false,
      isLoading: false,
    };
    renderAt('/workspaces');

    expect(screen.queryByTestId('entitlement-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });
});
