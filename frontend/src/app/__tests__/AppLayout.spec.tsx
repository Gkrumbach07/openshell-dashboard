import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { GatewayInfo } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: () => ({ data: { subject: 'user-1', roles: [] } }),
  useFeatureFlags: () => ({ globalPolicy: true, settings: true }),
}));
jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({ isPlatformAdmin: false }),
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
import { useGatewayInfo } from '../../api/gateway';

const mockUseGatewayInfo = useGatewayInfo as jest.Mock;

const mockGateway = (info: GatewayInfo) =>
  mockUseGatewayInfo.mockReturnValue({
    isLoading: false,
    isError: false,
    data: info,
  });

// The route does not matter: the shell wraps every authenticated page.
const renderShell = (route: string) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppLayout>
        <div data-testid="routed-page" />
      </AppLayout>
    </MemoryRouter>,
  );

describe('AppLayout gateway compatibility notice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['/workspaces', '/workspaces/default/sandboxes/agent', '/gateway'])(
    'shows the notice above the page on %s when the gateway is unsupported',
    (route) => {
      mockGateway({
        status: 'HEALTHY',
        gatewayVersion: '0.0.116',
        computeDrivers: [],
        compatibility: {
          status: 'unsupported',
          supportedMin: '0.1.0',
          supportedMax: '0.1.2',
        },
      });
      renderShell(route);

      const alert = screen.getByTestId('gateway-compatibility-alert');
      const page = screen.getByTestId('routed-page');
      // Inside the page's main region, and ahead of the routed content.
      expect(screen.getByRole('main')).toContainElement(alert);
      expect(
        alert.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(alert.closest('.pf-v6-c-page__main-section')).not.toBeNull();
    },
  );

  it('adds nothing to the page when the gateway is supported', () => {
    mockGateway({
      status: 'HEALTHY',
      gatewayVersion: '0.1.2',
      computeDrivers: [],
      compatibility: {
        status: 'supported',
        supportedMin: '0.1.0',
        supportedMax: '0.1.2',
      },
    });
    renderShell('/workspaces');

    expect(
      screen.queryByTestId('gateway-compatibility-alert'),
    ).not.toBeInTheDocument();
    // No leftover section either: the routed page is the first thing in main.
    expect(screen.getByRole('main').firstElementChild).toBe(
      screen.getByTestId('routed-page'),
    );
  });
});
