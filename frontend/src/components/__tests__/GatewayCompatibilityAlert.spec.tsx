import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GatewayCompatibilityAlert from '../GatewayCompatibilityAlert';
import type {
  GatewayCompatibility,
  GatewayCompatibilityInfo,
} from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayCompatibility: jest.fn(),
}));

import { useGatewayCompatibility } from '../../api/gateway';
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;

const gateway = (
  gatewayVersion: string,
  compatibility: GatewayCompatibility,
): GatewayCompatibilityInfo => ({ gatewayVersion, compatibility });

const mockGateway = (info: unknown, extra = {}) =>
  mockUseGatewayCompatibility.mockReturnValue({
    isLoading: false,
    isError: false,
    data: info,
    ...extra,
  });

const range = { supportedMin: '0.1.0', supportedMax: '0.1.2' };

const region = () => screen.getByTestId('gateway-compatibility-region');

// Nothing to say: no alert, and nothing else inside the live region either.
const expectNothingShown = () => {
  expect(
    screen.queryByTestId('gateway-compatibility-alert'),
  ).not.toBeInTheDocument();
  expect(region()).toBeEmptyDOMElement();
};

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
    expectNothingShown();

    // The same gateway polled again stays dismissed.
    rerender(<GatewayCompatibilityAlert />);
    expectNothingShown();

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
    // A gateway that does not know its own version is unknown even with a
    // range: the BFF does not guess, so neither does the notice.
    ['unknown with a range', gateway('0.0.0', { status: 'unknown', ...range })],
    // A host that replaced the route with something else.
    ['a response without a verdict', { gatewayVersion: '0.0.116' }],
  ])('shows nothing for %s', (_name, info) => {
    mockGateway(info);
    render(<GatewayCompatibilityAlert />);
    expectNothingShown();
  });

  it('shows nothing while the request is loading or has failed', () => {
    mockGateway(undefined, { isLoading: true });
    const { rerender } = render(<GatewayCompatibilityAlert />);
    expectNothingShown();

    mockGateway(undefined, { isError: true, error: new Error('down') });
    rerender(<GatewayCompatibilityAlert />);
    expectNothingShown();
  });

  it('passes className through to the alert', () => {
    mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
    render(<GatewayCompatibilityAlert className="pf-v6-u-mb-md" />);
    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveClass(
      'pf-v6-u-mb-md',
    );
  });

  // A screen reader only announces what is added to a live region that
  // already exists. The notice arrives after the page, when the request
  // resolves, so the region has to be there first and the alert has to land
  // inside it.
  describe('announcement', () => {
    it('keeps a polite live region in the page before there is anything to say', () => {
      mockGateway(undefined, { isLoading: true });
      render(<GatewayCompatibilityAlert />);

      expect(region()).toHaveAttribute('aria-live', 'polite');
      // Only what is added is read out, not the region as a whole.
      expect(region()).toHaveAttribute('aria-atomic', 'false');
      expect(region()).toBeEmptyDOMElement();
    });

    it('adds the notice to that same region when the verdict arrives', () => {
      mockGateway(undefined, { isLoading: true });
      const { rerender } = render(<GatewayCompatibilityAlert />);
      const regionAtLoad = region();

      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      rerender(<GatewayCompatibilityAlert />);

      // The very element that was in the page at load, not a new one.
      expect(region()).toBe(regionAtLoad);
      expect(regionAtLoad).toContainElement(
        screen.getByTestId('gateway-compatibility-alert'),
      );
    });

    it('does not touch the region when the same verdict is polled again', () => {
      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      const { rerender } = render(<GatewayCompatibilityAlert />);
      const alert = screen.getByTestId('gateway-compatibility-alert');

      const changes: MutationRecord[] = [];
      const observer = new MutationObserver((records) =>
        changes.push(...records),
      );
      observer.observe(region(), {
        childList: true,
        characterData: true,
        subtree: true,
      });

      // A fresh object with the same content, as a refetch produces.
      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      rerender(<GatewayCompatibilityAlert />);
      changes.push(...observer.takeRecords());
      observer.disconnect();

      expect(changes).toHaveLength(0);
      expect(screen.getByTestId('gateway-compatibility-alert')).toBe(alert);
    });

    it('keeps the region when the notice is dismissed, ready for the next one', () => {
      mockGateway(gateway('0.1.3', { status: 'untested', ...range }));
      render(<GatewayCompatibilityAlert />);
      const regionBefore = region();

      fireEvent.click(
        screen.getByTestId('gateway-compatibility-alert-dismiss'),
      );

      expect(region()).toBe(regionBefore);
      expectNothingShown();
    });
  });

  // The title is PatternFly's h4 unless the placement says otherwise: a
  // heading has to fit the outline of the page the alert is put in.
  describe('title element', () => {
    it('is a level 4 heading by default', () => {
      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      render(<GatewayCompatibilityAlert />);

      expect(
        screen.getByRole('heading', {
          level: 4,
          name: /This gateway is older than this dashboard supports/,
        }),
      ).toBeInTheDocument();
    });

    it.each([
      ['unsupported', gateway('0.0.116', { status: 'unsupported', ...range })],
      ['untested', gateway('0.1.3', { status: 'untested', ...range })],
    ])('can be a non-heading for the %s notice', (_name, info) => {
      mockGateway(info);
      render(<GatewayCompatibilityAlert component="div" />);

      const alert = screen.getByTestId('gateway-compatibility-alert');
      expect(within(alert).queryByRole('heading')).not.toBeInTheDocument();
      // Still the alert's title, with the variant spelled out for a screen
      // reader ("Warning alert:", "Info alert:").
      const title = alert.querySelector('.pf-v6-c-alert__title');
      expect(title?.tagName).toBe('DIV');
      expect(title).toHaveTextContent(/alert:This gateway is/);
    });
  });

  describe('wrapper', () => {
    const wrapper = (alert: React.ReactElement) => (
      <section data-testid="host-layout">{alert}</section>
    );

    it('wraps the alert when one is shown, inside the live region', () => {
      mockGateway(gateway('0.0.116', { status: 'unsupported', ...range }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);

      const layout = screen.getByTestId('host-layout');
      expect(layout).toContainElement(
        screen.getByTestId('gateway-compatibility-alert'),
      );
      expect(region()).toContainElement(layout);
    });

    it('leaves no empty container when there is nothing to say', () => {
      mockGateway(gateway('0.1.2', { status: 'supported', ...range }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);

      expect(screen.queryByTestId('host-layout')).not.toBeInTheDocument();
      expectNothingShown();
    });

    it('removes the container too when the notice is dismissed', () => {
      mockGateway(gateway('0.1.3', { status: 'untested', ...range }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);
      fireEvent.click(
        screen.getByTestId('gateway-compatibility-alert-dismiss'),
      );

      expect(screen.queryByTestId('host-layout')).not.toBeInTheDocument();
      expectNothingShown();
    });
  });
});
