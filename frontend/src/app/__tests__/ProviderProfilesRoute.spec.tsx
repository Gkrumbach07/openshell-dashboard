import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockIsPlatformAdmin = true;

jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isLoading: false,
  }),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: () => ({ data: { subject: 'user-1', roles: [] } }),
  useFeatureFlags: () => ({ globalPolicy: true, settings: true }),
}));
jest.mock('../../api/gateway', () => ({
  useGatewayInfo: () => ({ data: undefined }),
  useGatewayCompatibility: () => ({ data: undefined, isLoading: true }),
}));
jest.mock('../theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }),
}));
jest.mock('~/assets/openshell-logo.svg', () => ({
  __esModule: true,
  default: 'openshell-logo.svg',
}));
jest.mock('~/assets/openshell-logo-dark.svg', () => ({
  __esModule: true,
  default: 'openshell-logo-dark.svg',
}));

// The pages fetch their own data and have their own specs. Here each one only
// says that it is the page on screen.
const mockPage = (name: string) => ({
  __esModule: true,
  default: () => <div data-testid={`page-${name}`} />,
});
jest.mock('../../pages/ProviderProfilesPage', () =>
  mockPage('provider-profiles'),
);
jest.mock('../../pages/WorkspaceListPage', () => mockPage('workspaces'));
jest.mock('../../pages/GatewayOverviewPage', () => mockPage('gateway'));
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

// The sidebar is collapsed at the width of the test window, which hides it
// from the accessibility tree without taking it out of the page.
const nav = () =>
  screen.getByRole('navigation', {
    name: 'Primary navigation',
    hidden: true,
  });

// The platform's provider profiles are a platform-admin page, registered and
// gated the way Global policy and Settings are.
describe('the provider profiles page', () => {
  it('is in the navigation and on its route for a platform admin', () => {
    mockIsPlatformAdmin = true;
    renderAt('/provider-profiles');

    const link = within(nav()).getByRole('link', {
      name: 'Provider profiles',
      hidden: true,
    });
    expect(link).toHaveAttribute('href', '/provider-profiles');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-provider-profiles')).toBeInTheDocument();
  });

  it('is neither for anyone else', () => {
    mockIsPlatformAdmin = false;
    renderAt('/provider-profiles');

    expect(
      within(nav()).queryByRole('link', {
        name: 'Provider profiles',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('page-provider-profiles'),
    ).not.toBeInTheDocument();
    // Sent where every user may be, as from the other admin pages.
    expect(screen.getByTestId('page-workspaces')).toBeInTheDocument();
  });
});
