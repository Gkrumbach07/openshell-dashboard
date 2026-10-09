import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AuthConfig, CurrentUser } from '../../types';
import {
  sessionExpiredError,
  setSessionExpiredHandler,
} from '../../api/client';

jest.mock('../../api/auth', () => ({
  useAuthConfig: jest.fn(),
  useCurrentUser: jest.fn(),
}));

jest.mock('../AuthenticatedRoutes', () => ({
  __esModule: true,
  default: () => <div data-testid="authenticated-shell" />,
}));

jest.mock('../authSession', () => ({
  ...jest.requireActual('../authSession'),
  reloadPageForProxyReauth: jest.fn(),
  reloadOnceForProxyReauth: jest.fn(),
}));

import AppRoutes from '../AppRoutes';
import { useAuthConfig, useCurrentUser } from '../../api/auth';
import { catalogs } from '../../i18n';
import {
  reloadOnceForProxyReauth,
  reloadPageForProxyReauth,
} from '../authSession';

const mockUseAuthConfig = useAuthConfig as jest.Mock;
const mockUseCurrentUser = useCurrentUser as jest.Mock;
const mockReloadPage = reloadPageForProxyReauth as jest.Mock;
const mockAutoReload = reloadOnceForProxyReauth as jest.Mock;

const features: AuthConfig['features'] = {
  terminal: true,
  fileTransfer: true,
  settings: true,
  globalPolicy: true,
  credentialRefresh: true,
  services: true,
  draftPolicy: true,
};

const idleWhoami = {
  data: undefined,
  isLoading: false,
  isPending: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
};

const renderGate = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </MemoryRouter>,
  );

const requireAuth = () => {
  mockUseAuthConfig.mockReturnValue({
    data: { authDisabled: false, features } satisfies AuthConfig,
    isLoading: false,
  });
};

describe('AppRoutes', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
    setSessionExpiredHandler(null);
    mockUseCurrentUser.mockReturnValue(idleWhoami);
  });

  afterEach(() => {
    setSessionExpiredHandler(null);
  });

  it('shows the dev login page when AUTH_DISABLED is true', () => {
    mockUseAuthConfig.mockReturnValue({
      data: { authDisabled: true, features } satisfies AuthConfig,
      isLoading: false,
    });

    renderGate();

    expect(screen.getByTestId('dev-login')).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('shows Authentication required when the BFF has no bearer', () => {
    requireAuth();
    mockUseCurrentUser.mockReturnValue({
      ...idleWhoami,
      isError: true,
      error: { status: 401, code: 'unauthorized', message: 'Session expired' },
    });

    renderGate();

    expect(screen.getByTestId('auth-required')).toBeInTheDocument();
    expect(screen.getByText('make dev').closest('code')).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('shows a gateway-rejected session over cached user data and offers reload', () => {
    requireAuth();
    mockUseCurrentUser.mockReturnValue({
      ...idleWhoami,
      data: { subject: 'cached-user', roles: [] } satisfies CurrentUser,
      isError: true,
      error: {
        status: 401,
        code: 'unauthenticated',
        message: 'token rejected',
      },
    });

    renderGate();

    expect(
      screen.getByText(catalogs.en.auth.sessionRejectedTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(catalogs.en.auth.sessionRejectedBody),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('auth-required')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    sessionExpiredError('unauthorized');
    expect(mockAutoReload).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: catalogs.en.auth.sessionReload }),
    );
    expect(mockReloadPage).toHaveBeenCalledTimes(1);
  });

  it('shows the gateway response for 502 and retries whoami', () => {
    const refetch = jest.fn();
    requireAuth();
    mockUseCurrentUser.mockReturnValue({
      ...idleWhoami,
      isError: true,
      error: {
        status: 502,
        code: 'gateway_unavailable',
        message: 'OpenShell gateway is unreachable',
      },
      refetch,
    });

    renderGate();

    expect(
      screen.getByText('OpenShell gateway is unreachable'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(catalogs.en.auth.sessionBffUnreachable),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(catalogs.en.auth.sessionGatewayUnavailableHelp),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('advises users to contact an administrator for permission errors', () => {
    requireAuth();
    mockUseCurrentUser.mockReturnValue({
      ...idleWhoami,
      isError: true,
      error: {
        status: 403,
        code: 'permission_denied',
        message: 'Access denied',
      },
    });

    renderGate();

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(
      screen.getByText(catalogs.en.auth.sessionPermissionDeniedHelp),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('shows network recovery guidance for a network failure', () => {
    requireAuth();
    mockUseCurrentUser.mockReturnValue({
      ...idleWhoami,
      isError: true,
      error: new TypeError('Failed to fetch'),
    });

    renderGate();

    expect(
      screen.getByText(catalogs.en.auth.sessionBffUnreachable),
    ).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('shows loading spinner while whoami is pending', () => {
    mockUseAuthConfig.mockReturnValue({
      data: { authDisabled: false, features } satisfies AuthConfig,
      isLoading: false,
    });
    mockUseCurrentUser.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });

    renderGate();

    expect(
      screen.getByLabelText(catalogs.en.auth.sessionLoading),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('auth-required')).not.toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('mounts the authenticated shell after a successful whoami', () => {
    const user: CurrentUser = { subject: 'user-1', roles: [] };
    mockUseAuthConfig.mockReturnValue({
      data: { authDisabled: false, features } satisfies AuthConfig,
      isLoading: false,
    });
    mockUseCurrentUser.mockReturnValue({
      data: user,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });

    renderGate();

    expect(screen.getByTestId('authenticated-shell')).toBeInTheDocument();
  });
});
