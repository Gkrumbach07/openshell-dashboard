import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

  // What `openshell gateway info` lists under "Extensions": the configured
  // name and kind, the implementation with its version and protocol, what it
  // can do and what it needs from the gateway.
  it('displays the extensions the gateway negotiated', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.1.2',
      computeDrivers: [{ name: 'podman', driverName: 'podman' }],
      extensions: [
        {
          kind: 'COMPUTE_DRIVER',
          configuredName: 'podman',
          implementationName: 'example-driver',
          implementationVersion: '0.1.2',
          protocolMajor: 1,
          protocolMinor: 3,
          supportedCapabilities: ['capability-a', 'capability-b'],
          requiredCapabilities: ['gateway-capability'],
        },
        {
          kind: 'CREDENTIAL_DRIVER',
          configuredName: 'vault',
          protocolMajor: 2,
          protocolMinor: 0,
        },
      ],
    };
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: info,
    });
    render(<GatewayOverviewPage />);

    const card = within(screen.getByTestId('gateway-extensions-card'));
    expect(
      card.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'Name',
      'Kind',
      'Implementation',
      'Protocol',
      'Capabilities',
      'Requires from gateway',
    ]);
    const rows = card
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      [
        'podman',
        'Compute driver',
        'example-driver 0.1.2',
        '1.3',
        'capability-acapability-b',
        'gateway-capability',
      ],
      ['vault', 'Credential driver', '-', '2.0', '-', '-'],
    ]);
  });

  it('names every extension kind, and shows one it does not know as sent', () => {
    const kinds = [
      ['COMPUTE_DRIVER', 'Compute driver'],
      ['CREDENTIAL_DRIVER', 'Credential driver'],
      ['GATEWAY_INTERCEPTOR', 'Gateway interceptor'],
      ['SUPERVISOR_MIDDLEWARE', 'Supervisor middleware'],
      ['UNSPECIFIED', 'Unspecified'],
      ['SOMETHING_NEW', 'SOMETHING_NEW'],
    ];
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        status: 'HEALTHY',
        gatewayVersion: '0.1.2',
        computeDrivers: [],
        extensions: kinds.map(([kind], index) => ({
          kind,
          configuredName: `extension-${index}`,
          protocolMajor: 1,
          protocolMinor: 0,
        })),
      },
    });
    render(<GatewayOverviewPage />);

    for (const [index, [, label]] of kinds.entries()) {
      const row = screen.getByText(`extension-${index}`).closest('tr');
      expect(row).toHaveTextContent(label);
    }
  });

  // A gateway without extensions, and a BFF that predates the field, both
  // leave the card saying so instead of breaking the page.
  it.each([
    ['an empty list', []],
    ['no extensions field', undefined],
  ])('shows that none were reported for %s', (_name, extensions) => {
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        status: 'HEALTHY',
        gatewayVersion: '0.1.0',
        computeDrivers: [],
        extensions,
      },
    });
    render(<GatewayOverviewPage />);

    expect(
      within(screen.getByTestId('gateway-extensions-card')).getByText(
        'No extensions reported',
      ),
    ).toBeInTheDocument();
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
    expect(screen.getByText('No compute drivers reported')).toBeInTheDocument();
  });
});
