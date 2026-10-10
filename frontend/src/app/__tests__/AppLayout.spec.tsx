import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import type { GatewayCompatibility } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
  useGatewayCompatibility: jest.fn(),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: jest.fn(),
  useAuthConfig: jest.fn(),
  useFeatureFlags: () => ({ globalPolicy: true, settings: true }),
}));
// Real useUserRole — badge/nav cases set roles on useCurrentUser below.
jest.mock('../theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }),
}));
// Jest resolves the "~/" alias before it reaches the "*.svg" stub, so the two
// logos would otherwise be parsed as JavaScript.
jest.mock('~/assets/openshell-logo.svg', () => ({
  __esModule: true,
  default: 'openshell-logo.svg',
}));
jest.mock('~/assets/openshell-logo-dark.svg', () => ({
  __esModule: true,
  default: 'openshell-logo-dark.svg',
}));
// The commit a build is made from is compiled in by Vite, so here it is set
// per test: '' is a build nobody told, which is also what Jest sees.
const mockBuild = { commit: '' };
jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  get BUILD_COMMIT() {
    return mockBuild.commit;
  },
}));

import AppLayout from '../AppLayout';
import { useCurrentUser, useAuthConfig } from '../../api/auth';
import { useGatewayCompatibility, useGatewayInfo } from '../../api/gateway';

const mockUseGatewayInfo = useGatewayInfo as jest.Mock;
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;
const mockUseCurrentUser = useCurrentUser as jest.Mock;
const mockUseAuthConfig = useAuthConfig as jest.Mock;

/** Drive the real useUserRole hook via whoami roles (adminRole stays "admin"). */
const mockUser = (
  user: {
    roles?: string[] | null;
    isLoading?: boolean;
  } = {},
) => {
  mockUseAuthConfig.mockReturnValue({
    data: { adminRole: 'admin' },
  });
  mockUseCurrentUser.mockReturnValue({
    data: {
      subject: 'user-1',
      // undefined → []; null stays null so useUserRole's ?? [] is exercised
      roles: user.roles === undefined ? [] : user.roles,
    },
    isLoading: user.isLoading ?? false,
  });
};

// Default fixtures are not platform admins, so the shell's own gateway-info
// request is refused, as a gateway with roles refuses it. The notice must
// not depend on it.
const refuseGatewayInfo = () =>
  mockUseGatewayInfo.mockReturnValue({
    isLoading: false,
    isError: true,
    error: new Error("role 'openshell-admin' required"),
    data: undefined,
  });

const mockVerdict = (
  gatewayVersion: string,
  compatibility: GatewayCompatibility,
) =>
  mockUseGatewayCompatibility.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { gatewayVersion, compatibility },
  });

const line = { supportedLine: '0.1' };

const renderShell = (route: string, page: React.ReactNode) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppLayout>{page}</AppLayout>
    </MemoryRouter>,
  );

// A page as every routed page starts: its own level 1 heading.
const page = (
  <div data-testid="routed-page">
    <h1>Workspaces</h1>
  </div>
);

describe('AppLayout role badge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refuseGatewayInfo();
    mockVerdict('0.1.2', { status: 'supported', ...line });
    mockUser();
  });

  it('shows Standard user when roles include a non-admin role', () => {
    mockUser({ roles: ['user'] });
    renderShell('/workspaces', page);

    expect(screen.getByTestId('role-badge')).toHaveTextContent('Standard user');
  });

  it('shows Platform admin when roles include the admin role', () => {
    mockUser({ roles: ['admin'] });
    renderShell('/workspaces', page);

    expect(screen.getByTestId('role-badge')).toHaveTextContent(
      'Platform admin',
    );
  });

  it('hides the badge when roles are empty', () => {
    mockUser({ roles: [] });
    renderShell('/workspaces', page);

    expect(screen.queryByTestId('role-badge')).not.toBeInTheDocument();
  });

  it('hides the badge when roles are null', () => {
    mockUser({ roles: null });
    renderShell('/workspaces', page);

    expect(screen.queryByTestId('role-badge')).not.toBeInTheDocument();
  });

  it('hides the badge while the role is loading', () => {
    mockUser({ roles: ['user'], isLoading: true });
    renderShell('/workspaces', page);

    expect(screen.queryByTestId('role-badge')).not.toBeInTheDocument();
  });
});

// Platform-admin UI gates (display/hide only — gateway still enforces).
describe('AppLayout platform-admin gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refuseGatewayInfo();
    mockVerdict('0.1.2', { status: 'supported', ...line });
    mockUser({ roles: ['user'] });
  });

  it('hides Gateway, Global policy, and Settings nav for a User', () => {
    renderShell('/workspaces', page);

    const nav = screen.getByLabelText('Primary navigation');
    expect(within(nav).getByText('Workspaces')).toBeInTheDocument();
    expect(within(nav).queryByText('Gateway')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Global policy')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Settings')).not.toBeInTheDocument();
  });

  it('shows Gateway, Global policy, and Settings nav for a Platform Admin', () => {
    mockUser({ roles: ['admin'] });
    renderShell('/workspaces', page);

    const nav = screen.getByLabelText('Primary navigation');
    expect(within(nav).getByText('Gateway')).toBeInTheDocument();
    expect(within(nav).getByText('Workspaces')).toBeInTheDocument();
    expect(within(nav).getByText('Global policy')).toBeInTheDocument();
    expect(within(nav).getByText('Settings')).toBeInTheDocument();
  });

  it('points the logo home at /workspaces for a User', () => {
    renderShell('/workspaces', page);

    expect(
      screen.getByAltText('OpenShell Dashboard').closest('a'),
    ).toHaveAttribute('href', '/workspaces');
  });

  it('points the logo home at /gateway for a Platform Admin', () => {
    mockUser({ roles: ['admin'] });
    renderShell('/workspaces', page);

    expect(
      screen.getByAltText('OpenShell Dashboard').closest('a'),
    ).toHaveAttribute('href', '/gateway');
  });
});

describe('AppLayout gateway compatibility notice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refuseGatewayInfo();
    mockUser({ roles: ['user'] });
  });

  // The route does not matter: the shell wraps every authenticated page.
  it.each(['/workspaces', '/workspaces/default/sandboxes/agent', '/gateway'])(
    'shows the notice above the page on %s when the gateway is unsupported',
    (route) => {
      mockVerdict('0.0.116', { status: 'unsupported', ...line });
      renderShell(route, page);

      const alert = screen.getByTestId('gateway-compatibility-alert');
      const routed = screen.getByTestId('routed-page');
      // Inside the page's main region, and ahead of the routed content.
      expect(screen.getByRole('main')).toContainElement(alert);
      expect(
        alert.compareDocumentPosition(routed) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(alert.closest('.pf-v6-c-page__main-section')).not.toBeNull();
    },
  );

  it('shows it to a user whose gateway-info request is refused', () => {
    mockVerdict('0.0.116', { status: 'unsupported', ...line });
    renderShell('/workspaces', page);

    // The shell did ask for gateway info, and got nothing...
    expect(mockUseGatewayInfo).toHaveBeenCalled();
    // ...and the notice is there anyway, naming the version.
    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveTextContent(
      'This gateway reports 0.0.116.',
    );
  });

  it('adds nothing visible to the page when the gateway is supported', () => {
    mockVerdict('0.1.2', { status: 'supported', ...line });
    renderShell('/workspaces', page);

    expect(
      screen.queryByTestId('gateway-compatibility-alert'),
    ).not.toBeInTheDocument();
    // Only the empty live region is ahead of the routed page: no section, no
    // padding, nothing to read.
    const main = screen.getByRole('main');
    const region = screen.getByTestId('gateway-compatibility-region');
    expect(region).toBeEmptyDOMElement();
    expect(main.querySelector('.pf-v6-c-page__main-section')).toBeNull();
    expect(main.firstElementChild).toBe(region);
    expect(region.nextElementSibling).toBe(screen.getByTestId('routed-page'));
  });

  it('does not put a heading above the page h1 for the notice', () => {
    mockVerdict('0.2.0', { status: 'unsupported', ...line });
    renderShell('/workspaces', page);

    const main = screen.getByRole('main');
    const alert = screen.getByTestId('gateway-compatibility-alert');
    expect(within(alert).queryByRole('heading')).not.toBeInTheDocument();
    // The first heading a screen reader user meets in main is the page's.
    const headings = within(main).getAllByRole('heading');
    expect(headings[0]).toBe(
      screen.getByRole('heading', { level: 1, name: 'Workspaces' }),
    );
  });

  it('has its live region in the page before the verdict arrives', () => {
    mockUseGatewayCompatibility.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });
    renderShell('/workspaces', page);

    const region = screen.getByTestId('gateway-compatibility-region');
    expect(screen.getByRole('main')).toContainElement(region);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  // The shell stays mounted while the route changes, so the notice is the
  // same element before and after, and nothing is added to or changed in the
  // live region. That is what keeps a screen reader from reading it out again
  // on every page.
  it('is not announced again when the user navigates', () => {
    mockVerdict('0.0.116', { status: 'unsupported', ...line });
    renderShell(
      '/workspaces',
      <Routes>
        <Route
          path="/workspaces"
          element={
            <Link to="/workspaces/default" data-testid="open-workspace">
              default
            </Link>
          }
        />
        <Route
          path="/workspaces/:workspace"
          element={<div data-testid="workspace-page" />}
        />
      </Routes>,
    );

    const region = screen.getByTestId('gateway-compatibility-region');
    const alert = screen.getByTestId('gateway-compatibility-alert');
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      changes.push(...records),
    );
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    fireEvent.click(screen.getByTestId('open-workspace'));
    expect(screen.getByTestId('workspace-page')).toBeInTheDocument();
    changes.push(...observer.takeRecords());
    observer.disconnect();

    expect(changes).toHaveLength(0);
    expect(screen.getByTestId('gateway-compatibility-region')).toBe(region);
    expect(screen.getByTestId('gateway-compatibility-alert')).toBe(alert);
  });
});

// What identifies a build to the person looking at it. An image is built
// before any release is cut, so it has no version number of its own.
describe('AppLayout About dialog', () => {
  const openAbout = async () => {
    // The menu positions itself a tick after it opens and again after it
    // closes; act() waits for both, so neither lands outside the test.
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-menu'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    });
    return screen.getByRole('dialog');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuild.commit = '';
    refuseGatewayInfo();
    mockVerdict('0.1.3', { status: 'supported', ...line });
    mockUser({ roles: ['user'] });
  });

  it('shows the gateway release line the dashboard is built for', async () => {
    renderShell('/workspaces', page);
    const about = await openAbout();

    expect(within(about).getByText('Built for gateway')).toBeInTheDocument();
    expect(within(about).getByTestId('about-gateway-line')).toHaveTextContent(
      /^0\.1\.x$/,
    );
  });

  it('shows the commit the build is made from when the build knows it', async () => {
    mockBuild.commit = 'a3d90c7';
    renderShell('/workspaces', page);
    const about = await openAbout();

    expect(within(about).getByText('Dashboard commit')).toBeInTheDocument();
    expect(
      within(about).getByTestId('about-dashboard-commit'),
    ).toHaveTextContent(/^a3d90c7$/);
  });

  // An image built with no build args: the line still comes from the BFF,
  // and nothing is said about a commit.
  it('says nothing about a commit when the build was not told one', async () => {
    renderShell('/workspaces', page);
    const about = await openAbout();

    expect(within(about).getByTestId('about-gateway-line')).toHaveTextContent(
      '0.1.x',
    );
    expect(
      within(about).queryByText('Dashboard commit'),
    ).not.toBeInTheDocument();
    expect(
      within(about).queryByTestId('about-dashboard-commit'),
    ).not.toBeInTheDocument();
  });

  it('never shows a made-up version number', async () => {
    mockBuild.commit = 'a3d90c7';
    renderShell('/workspaces', page);
    const about = await openAbout();

    expect(
      within(about).queryByText('Dashboard version'),
    ).not.toBeInTheDocument();
    expect(about).not.toHaveTextContent(/semantically-released|0\.0\.0/);
  });

  it('says the line is unknown when the BFF has none, or has not answered', async () => {
    mockVerdict('0.1.3', { status: 'unknown' });
    const { unmount } = renderShell('/workspaces', page);
    expect(
      within(await openAbout()).getByTestId('about-gateway-line'),
    ).toHaveTextContent('Unknown');
    unmount();

    mockUseGatewayCompatibility.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });
    renderShell('/workspaces', page);
    expect(
      within(await openAbout()).getByTestId('about-gateway-line'),
    ).toHaveTextContent('Unknown');
  });

  // The gateway refuses GET /gateway to anyone but a platform admin. The line
  // is read from the route every signed-in user may call.
  it('shows the line to a user whose gateway-info request is refused', async () => {
    renderShell('/workspaces', page);
    const about = await openAbout();

    expect(mockUseGatewayInfo).toHaveBeenCalled();
    expect(within(about).getByTestId('about-gateway-line')).toHaveTextContent(
      '0.1.x',
    );
  });
});
