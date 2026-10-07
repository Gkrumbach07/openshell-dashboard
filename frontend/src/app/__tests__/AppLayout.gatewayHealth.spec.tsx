import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

let mockIsPlatformAdmin = false;

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
  useGatewayCompatibility: jest.fn(),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: () => ({ data: { subject: 'user-1', roles: [] } }),
  useFeatureFlags: () => ({ globalPolicy: true, settings: true }),
}));
jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({ isPlatformAdmin: mockIsPlatformAdmin }),
}));
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

import AppLayout from '../AppLayout';
import { useGatewayCompatibility, useGatewayInfo } from '../../api/gateway';

const mockUseGatewayInfo = useGatewayInfo as jest.Mock;
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;

// What a gateway with roles answers a user who is not a platform admin when
// the shell asks it for gateway info: a refusal. The health in the masthead
// must not depend on it.
const refuseGatewayInfo = () =>
  mockUseGatewayInfo.mockReturnValue({
    isLoading: false,
    isError: true,
    error: Object.assign(new Error("role 'openshell-admin' required"), {
      status: 403,
    }),
    data: undefined,
  });

const answerHealth = (healthy: boolean) =>
  mockUseGatewayCompatibility.mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: {
      gatewayVersion: '0.1.2',
      healthy,
      compatibility: { status: 'supported' },
    },
  });

const renderShell = (page: React.ReactNode = <h1>Workspaces</h1>) =>
  render(
    <MemoryRouter
      initialEntries={['/workspaces']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppLayout>{page}</AppLayout>
    </MemoryRouter>,
  );

const masthead = () => within(screen.getByRole('banner'));

// The TUI shows the gateway's health to every user. The dashboard showed it
// on the Gateway page only, which a user who is not a platform admin cannot
// open.
describe('AppLayout gateway health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = false;
    refuseGatewayInfo();
  });

  it('shows the health in the masthead to a user who is not a platform admin', () => {
    answerHealth(true);
    renderShell();

    // The gateway-info request was made and refused...
    expect(mockUseGatewayInfo).toHaveBeenCalled();
    // ...and the health is there all the same.
    expect(
      masthead().getByTestId('gateway-status-indicator'),
    ).toHaveTextContent('Gateway healthy');
    // The Gateway page is still not offered to this user.
    expect(
      screen.queryByRole('link', { name: 'Gateway' }),
    ).not.toBeInTheDocument();
  });

  it('shows it to a platform admin as well', () => {
    mockIsPlatformAdmin = true;
    answerHealth(false);
    renderShell();

    expect(
      masthead().getByTestId('gateway-status-indicator'),
    ).toHaveTextContent('Gateway not healthy');
  });

  it('says the gateway is unreachable when the health request fails for that reason', () => {
    mockUseGatewayCompatibility.mockReturnValue({
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('OpenShell gateway is unreachable'), {
        status: 502,
        code: 'gateway_unavailable',
      }),
      // The answer from before the gateway went away.
      data: {
        gatewayVersion: '0.1.2',
        healthy: true,
        compatibility: { status: 'supported' },
      },
    });
    renderShell();

    expect(
      masthead().getByTestId('gateway-status-indicator'),
    ).toHaveTextContent('Gateway unreachable');
  });

  // The shell stays mounted while the routes change under it, so the status
  // is announced when it changes and not again on every page.
  it('keeps the same status region across navigation', () => {
    answerHealth(true);
    renderShell(
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
    const region = screen.getByTestId('gateway-status-region');

    fireEvent.click(screen.getByTestId('open-workspace'));

    expect(screen.getByTestId('workspace-page')).toBeInTheDocument();
    expect(screen.getByTestId('gateway-status-region')).toBe(region);
  });
});
