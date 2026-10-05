import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GatewayCompatibilityAlert from '../GatewayCompatibilityAlert';
import type { GatewayCompatibility, GatewayInfo } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
}));

import { useGatewayInfo } from '../../api/gateway';
const mockUseGatewayInfo = useGatewayInfo as jest.Mock;

const gateway = (
  gatewayVersion: string,
  compatibility?: GatewayCompatibility,
): GatewayInfo => ({
  status: 'HEALTHY',
  gatewayVersion,
  computeDrivers: [],
  compatibility,
});

const mockGateway = (info: GatewayInfo | undefined, extra = {}) =>
  mockUseGatewayInfo.mockReturnValue({
    isLoading: false,
    isError: false,
    data: info,
    ...extra,
  });

const range = { supportedMin: '0.1.0', supportedMax: '0.1.2' };

describe('GatewayCompatibilityAlert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns when the gateway is older than the dashboard supports', () => {
    mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
    render(<GatewayCompatibilityAlert />);

    const alert = screen.getByTestId('gateway-compatibility-alert');
    expect(alert).toHaveAttribute('data-status', 'unsupported');
    expect(alert).toHaveClass('pf-m-warning', 'pf-m-inline');
    expect(
      screen.getByText('This gateway is older than this dashboard supports'),
    ).toBeInTheDocument();
    // Names the version found, the range expected, and both ways out.
    expect(alert).toHaveTextContent('The gateway reports version 0.0.116.');
    expect(alert).toHaveTextContent(
      'Supported gateway versions: 0.1.0 to 0.1.2.',
    );
    expect(alert).toHaveTextContent(
      'Upgrade the gateway to a supported version, or use a dashboard release that supports gateway 0.0.116.',
    );
  });

  it('keeps the warning on screen: it has no close button', () => {
    mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
    render(<GatewayCompatibilityAlert />);

    expect(
      screen.queryByTestId('gateway-compatibility-alert-dismiss'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('informs when the gateway is newer than the dashboard was tested with', () => {
    mockGateway(
      gateway('0.1.3-dev.84+ge7fdd6bee', { status: 'untested', ...range }),
    );
    render(<GatewayCompatibilityAlert />);

    const alert = screen.getByTestId('gateway-compatibility-alert');
    expect(alert).toHaveAttribute('data-status', 'untested');
    expect(alert).toHaveClass('pf-m-info', 'pf-m-inline');
    expect(
      screen.getByText(
        'This gateway is newer than this dashboard was tested with',
      ),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      'The gateway reports version 0.1.3-dev.84+ge7fdd6bee.',
    );
    expect(alert).toHaveTextContent('Tested gateway versions: 0.1.0 to 0.1.2.');
    expect(alert).toHaveTextContent('may work as expected');
  });

  it('lets the untested notice be dismissed, until the gateway version changes', () => {
    mockGateway(gateway('0.1.3', { status: 'untested', ...range }));
    const { rerender } = render(<GatewayCompatibilityAlert />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss gateway version notice' }),
    );
    expect(
      screen.queryByTestId('gateway-compatibility-alert'),
    ).not.toBeInTheDocument();

    // The same gateway polled again stays dismissed.
    rerender(<GatewayCompatibilityAlert />);
    expect(
      screen.queryByTestId('gateway-compatibility-alert'),
    ).not.toBeInTheDocument();

    // A different untested version is news, so the notice returns.
    mockGateway(gateway('0.1.4', { status: 'untested', ...range }));
    rerender(<GatewayCompatibilityAlert />);
    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveTextContent(
      'The gateway reports version 0.1.4.',
    );
  });

  it('names a single version when the range is one release wide', () => {
    mockGateway(
      gateway('0.1.1', {
        status: 'unsupported',
        supportedMin: '0.1.2',
        supportedMax: '0.1.2',
      }),
    );
    render(<GatewayCompatibilityAlert />);

    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveTextContent(
      'Supported gateway versions: 0.1.2. Pages',
    );
  });

  it.each([
    ['supported', gateway('0.1.2', { status: 'supported', ...range })],
    ['unknown', gateway('0.0.116', { status: 'unknown' })],
    // An older BFF, or a host that replaced the /gateway route.
    ['a response without a verdict', gateway('0.0.116')],
  ])('renders nothing for %s', (_name, info) => {
    mockGateway(info);
    const { container } = render(<GatewayCompatibilityAlert />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the gateway request is loading or has failed', () => {
    mockGateway(undefined, { isLoading: true });
    const { container, rerender } = render(<GatewayCompatibilityAlert />);
    expect(container).toBeEmptyDOMElement();

    mockGateway(undefined, { isError: true, error: new Error('down') });
    rerender(<GatewayCompatibilityAlert />);
    expect(container).toBeEmptyDOMElement();
  });

  it('passes className through to the alert', () => {
    mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
    render(<GatewayCompatibilityAlert className="pf-v6-u-mb-md" />);
    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveClass(
      'pf-v6-u-mb-md',
    );
  });

  describe('wrapper', () => {
    const wrapper = (alert: React.ReactElement) => (
      <section data-testid="host-layout">{alert}</section>
    );

    it('wraps the alert when one is shown', () => {
      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);
      expect(screen.getByTestId('host-layout')).toContainElement(
        screen.getByTestId('gateway-compatibility-alert'),
      );
    });

    it('leaves no empty container when there is nothing to say', () => {
      mockGateway(gateway('0.1.2', { status: 'supported', ...range }));
      const { container } = render(
        <GatewayCompatibilityAlert wrapper={wrapper} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('removes the container too when the notice is dismissed', () => {
      mockGateway(gateway('0.1.3', { status: 'untested', ...range }));
      const { container } = render(
        <GatewayCompatibilityAlert wrapper={wrapper} />,
      );
      fireEvent.click(
        screen.getByTestId('gateway-compatibility-alert-dismiss'),
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});
