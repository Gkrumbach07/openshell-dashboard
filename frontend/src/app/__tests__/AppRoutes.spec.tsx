import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AuthConfig, CurrentUser } from '../../types';
import { setSessionExpiredHandler } from '../../api/client';

jest.mock('../../api/auth', () => ({
  useAuthConfig: jest.fn(),
  useCurrentUser: jest.fn(),
}));

jest.mock('../AuthenticatedRoutes', () => ({
  __esModule: true,
  default: () => <div data-testid="authenticated-shell" />,
}));

import AppRoutes from '../AppRoutes';
import { useAuthConfig, useCurrentUser } from '../../api/auth';

const mockUseAuthConfig = useAuthConfig as jest.Mock;
const mockUseCurrentUser = useCurrentUser as jest.Mock;

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

  it('shows Authentication required when whoami returns 401', () => {
    mockUseAuthConfig.mockReturnValue({
      data: { authDisabled: false, features } satisfies AuthConfig,
      isLoading: false,
    });
    mockUseCurrentUser.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 401, message: 'Session expired' },
      refetch: jest.fn(),
    });

    renderGate();

    expect(screen.getByTestId('auth-required')).toBeInTheDocument();
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
      isError: false,
      error: null,
      refetch: jest.fn(),
    });

    renderGate();

    expect(screen.getByTestId('authenticated-shell')).toBeInTheDocument();
  });
});
