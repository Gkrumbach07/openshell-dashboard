import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockRole = { isPlatformAdmin: false, isLoading: false };
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
jest.mock('../../pages/AllWorkspacesPage', () => mockPage('all-workspaces'));
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
    mockRole = { isPlatformAdmin: false, isLoading: false };
  });

  // The gateway answers the lists across workspaces for platform admins
  // only. The route does not decide that: it just does not send anyone else
  // to a page that could only show them a refusal.
  it('shows the all-workspaces page to a platform admin', () => {
    mockRole = { isPlatformAdmin: true, isLoading: false };
    renderAt('/all-workspaces');

    expect(screen.getByTestId('all-workspaces')).toBeInTheDocument();
  });

  it('sends anyone else to their workspaces instead', () => {
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
  });

  it('decides nothing while the role is still loading', () => {
    mockRole = { isPlatformAdmin: false, isLoading: true };
    renderAt('/all-workspaces');

    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list')).not.toBeInTheDocument();
  });

  // It sits beside /workspaces, not under it: a workspace named
  // "all-workspaces" would otherwise be shadowed, and the reverse.
  it('keeps the workspace routes where they were', () => {
    mockRole = { isPlatformAdmin: true, isLoading: false };

    const { unmount } = renderAt('/workspaces');
    expect(screen.getByTestId('workspace-list')).toBeInTheDocument();
    unmount();

    renderAt('/workspaces/all-workspaces');
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('all-workspaces')).not.toBeInTheDocument();
  });
});
