import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

const line = { supportedLine: '0.1' };

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

  it('warns when the gateway is on a newer release line', () => {
    mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
    render(<GatewayCompatibilityAlert />);

    const alert = screen.getByTestId('gateway-compatibility-alert');
    expect(alert).toHaveAttribute('data-status', 'unsupported');
    expect(alert).toHaveClass('pf-m-warning', 'pf-m-inline');
    expect(
      screen.getByText('This dashboard does not support this gateway version'),
    ).toBeInTheDocument();
    // Names the line the dashboard is for, the version found, and both ways
    // out.
    expect(alert).toHaveTextContent(
      'This dashboard is built for OpenShell gateway 0.1.x. This gateway reports 0.2.0.',
    );
    expect(alert).toHaveTextContent(
      'Use a gateway 0.1.x release, or a dashboard release built for gateway 0.2.0.',
    );
  });

  it('says the same about a gateway on an older release line', () => {
    mockGateway(gateway('0.0.116', { status: 'unsupported', ...line }));
    render(<GatewayCompatibilityAlert />);

    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveTextContent(
      'This dashboard is built for OpenShell gateway 0.1.x. This gateway reports 0.0.116.',
    );
  });

  it('reports the version as the gateway wrote it, suffix included', () => {
    mockGateway(gateway('0.2.0-pre.1', { status: 'unsupported', ...line }));
    render(<GatewayCompatibilityAlert />);

    expect(screen.getByTestId('gateway-compatibility-alert')).toHaveTextContent(
      'This gateway reports 0.2.0-pre.1.',
    );
  });

  it('keeps the warning on screen: it has no close button', () => {
    mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
    render(<GatewayCompatibilityAlert />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['supported', gateway('0.1.3', { status: 'supported', ...line })],
    // A later patch, a pre-release and a downstream rebuild of the line are
    // the line: the BFF says supported and nothing is shown.
    ['a later patch', gateway('0.1.9', { status: 'supported', ...line })],
    ['a pre-release', gateway('0.1.4-pre.2', { status: 'supported', ...line })],
    ['a rebuild', gateway('0.1.2-rhaiv.5', { status: 'supported', ...line })],
    // A gateway that does not know its own version is unknown: the BFF does
    // not guess, so neither does the notice.
    ['unknown', gateway('0.0.0', { status: 'unknown', ...line })],
    ['unknown without a line', gateway('0.0.116', { status: 'unknown' })],
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
    mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
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

      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      rerender(<GatewayCompatibilityAlert />);

      // The very element that was in the page at load, not a new one.
      expect(region()).toBe(regionAtLoad);
      expect(regionAtLoad).toContainElement(
        screen.getByTestId('gateway-compatibility-alert'),
      );
    });

    it('does not touch the region when the same verdict is polled again', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
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
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      rerender(<GatewayCompatibilityAlert />);
      changes.push(...observer.takeRecords());
      observer.disconnect();

      expect(changes).toHaveLength(0);
      expect(screen.getByTestId('gateway-compatibility-alert')).toBe(alert);
    });

    it('keeps the region when the gateway is replaced by a supported one', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      const { rerender } = render(<GatewayCompatibilityAlert />);
      const regionBefore = region();

      mockGateway(gateway('0.1.3', { status: 'supported', ...line }));
      rerender(<GatewayCompatibilityAlert />);

      expect(region()).toBe(regionBefore);
      expectNothingShown();
    });
  });

  // The title is PatternFly's h4 unless the placement says otherwise: a
  // heading has to fit the outline of the page the alert is put in.
  describe('title element', () => {
    it('is a level 4 heading by default', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      render(<GatewayCompatibilityAlert />);

      expect(
        screen.getByRole('heading', {
          level: 4,
          name: /This dashboard does not support this gateway version/,
        }),
      ).toBeInTheDocument();
    });

    it('can be a non-heading', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      render(<GatewayCompatibilityAlert component="div" />);

      const alert = screen.getByTestId('gateway-compatibility-alert');
      expect(within(alert).queryByRole('heading')).not.toBeInTheDocument();
      // Still the alert's title, with the variant spelled out for a screen
      // reader ("Warning alert:").
      const title = alert.querySelector('.pf-v6-c-alert__title');
      expect(title?.tagName).toBe('DIV');
      expect(title).toHaveTextContent(
        /Warning alert:This dashboard does not support/,
      );
    });
  });

  describe('wrapper', () => {
    const wrapper = (alert: React.ReactElement) => (
      <section data-testid="host-layout">{alert}</section>
    );

    it('wraps the alert when one is shown, inside the live region', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);

      const layout = screen.getByTestId('host-layout');
      expect(layout).toContainElement(
        screen.getByTestId('gateway-compatibility-alert'),
      );
      expect(region()).toContainElement(layout);
    });

    it('leaves no empty container when there is nothing to say', () => {
      mockGateway(gateway('0.1.3', { status: 'supported', ...line }));
      render(<GatewayCompatibilityAlert wrapper={wrapper} />);

      expect(screen.queryByTestId('host-layout')).not.toBeInTheDocument();
      expectNothingShown();
    });

    it('removes the container too when the notice goes away', () => {
      mockGateway(gateway('0.2.0', { status: 'unsupported', ...line }));
      const { rerender } = render(
        <GatewayCompatibilityAlert wrapper={wrapper} />,
      );

      mockGateway(gateway('0.1.3', { status: 'supported', ...line }));
      rerender(<GatewayCompatibilityAlert wrapper={wrapper} />);

      expect(screen.queryByTestId('host-layout')).not.toBeInTheDocument();
      expectNothingShown();
    });
  });
});
