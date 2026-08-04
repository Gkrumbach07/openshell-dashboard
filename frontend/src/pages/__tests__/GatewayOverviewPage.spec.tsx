import React from 'react';
import { render, screen } from '@testing-library/react';
import GatewayOverviewPage from '../GatewayOverviewPage';
import type { GatewayInfo } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
}));

import { useGatewayInfo } from '../../api/gateway';
const mockUseGatewayInfo = useGatewayInfo as jest.Mock;

describe('GatewayOverviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows spinner during loading', () => {
    mockUseGatewayInfo.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });
    render(<GatewayOverviewPage />);
    expect(screen.getByLabelText('Loading gateway info')).toBeInTheDocument();
  });

  it('shows error alert on fetch failure', () => {
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Connection refused'),
      refetch: jest.fn(),
    });
    render(<GatewayOverviewPage />);
    expect(
      screen.getByText('Cannot reach the OpenShell gateway'),
    ).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('displays gateway version and status', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.0.92',
      computeDrivers: [
        { name: 'local-podman', driverName: 'podman', driverVersion: '5.2.0' },
      ],
    };
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: info,
    });
    render(<GatewayOverviewPage />);
    expect(screen.getByText('0.0.92')).toBeInTheDocument();
    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByTestId('gateway-status-card')).toBeInTheDocument();
    expect(screen.getByTestId('gateway-version-card')).toBeInTheDocument();
  });

  it('displays compute drivers table', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.0.92',
      computeDrivers: [
        { name: 'local-podman', driverName: 'podman', driverVersion: '5.2.0' },
        {
          name: 'k8s-cluster',
          driverName: 'kubernetes',
          driverVersion: '1.30',
        },
      ],
    };
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: info,
    });
    render(<GatewayOverviewPage />);
    expect(screen.getByTestId('gateway-drivers-card')).toBeInTheDocument();
    expect(screen.getByText('local-podman')).toBeInTheDocument();
    expect(screen.getByText('k8s-cluster')).toBeInTheDocument();
  });

  it('shows empty driver message when none reported', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.0.92',
      computeDrivers: [],
    };
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: info,
    });
    render(<GatewayOverviewPage />);
    expect(
      screen.getByText('No compute drivers reported'),
    ).toBeInTheDocument();
  });
});
