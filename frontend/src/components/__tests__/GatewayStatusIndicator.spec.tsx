import React from 'react';
import { render, screen } from '@testing-library/react';
import GatewayStatusIndicator, {
  gatewayHealthStateOf,
} from '../GatewayStatusIndicator';
import type { GatewayCompatibilityInfo } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayCompatibility: jest.fn(),
}));

import { useGatewayCompatibility } from '../../api/gateway';
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;

// An error as the API client throws it: the BFF's message, with the HTTP
// status and the BFF's code.
const apiError = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });

const unreachable = apiError(
  502,
  'gateway_unavailable',
  'OpenShell gateway is unreachable',
);

const answer = (healthy?: boolean): GatewayCompatibilityInfo => ({
  gatewayVersion: '0.1.2',
  ...(healthy === undefined ? {} : { healthy }),
  compatibility: { status: 'supported' },
});

const serve = (query: {
  data?: GatewayCompatibilityInfo;
  isError?: boolean;
  error?: unknown;
}) =>
  mockUseGatewayCompatibility.mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: undefined,
    ...query,
  });

const indicator = () => screen.getByTestId('gateway-status-indicator');

describe('gatewayHealthStateOf', () => {
  it.each([
    ['the gateway answered healthy', { data: answer(true) }, 'healthy'],
    [
      'the gateway answered something other than healthy',
      { data: answer(false) },
      'notHealthy',
    ],
    ['the BFF reported no health', { data: answer() }, 'unknown'],
    ['there is no answer yet', {}, undefined],
    [
      'the gateway did not answer the BFF',
      { isError: true, error: unreachable },
      'unreachable',
    ],
    [
      'the BFF itself did not answer',
      { isError: true, error: new TypeError('Failed to fetch') },
      'unknown',
    ],
    [
      'the BFF answered with an error of its own',
      { isError: true, error: apiError(500, 'internal', 'internal error') },
      'unknown',
    ],
    [
      'the BFF is behind a gateway that timed out',
      { isError: true, error: apiError(504, '', 'Request failed (504)') },
      'unreachable',
    ],
    [
      'the BFF is not ready',
      { isError: true, error: apiError(503, 'not_ready', 'not ready') },
      'unreachable',
    ],
  ])('reads %s', (_name, query, state) => {
    expect(
      gatewayHealthStateOf({ isError: false, error: null, ...query }),
    ).toBe(state);
  });

  // React Query keeps the last answer when a refresh fails. That answer is
  // from before the gateway went away and must not be what is shown.
  it.each([
    [unreachable, 'unreachable'],
    [new TypeError('Failed to fetch'), 'unknown'],
  ])(
    'does not go on reading healthy from an answer that is stale (%s)',
    (error, state) => {
      expect(
        gatewayHealthStateOf({ isError: true, error, data: answer(true) }),
      ).toBe(state);
    },
  );
});

describe('GatewayStatusIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [{ data: answer(true) }, 'healthy', 'Gateway healthy', 'pf-m-success'],
    [
      { data: answer(false) },
      'notHealthy',
      'Gateway not healthy',
      'pf-m-warning',
    ],
    [
      { isError: true, error: unreachable },
      'unreachable',
      'Gateway unreachable',
      'pf-m-danger',
    ],
    // Not a state of the gateway, so it has none of the status colours.
    [{ data: answer() }, 'unknown', 'Gateway status unknown', undefined],
  ])('shows %# in words and in colour', (query, state, label, className) => {
    serve(query);
    render(<GatewayStatusIndicator />);

    expect(indicator()).toHaveAttribute('data-state', state);
    // The words carry the state. The colour only repeats it.
    expect(indicator()).toHaveTextContent(label);
    for (const status of ['pf-m-success', 'pf-m-warning', 'pf-m-danger']) {
      if (status === className) {
        expect(indicator()).toHaveClass(status);
      } else {
        expect(indicator()).not.toHaveClass(status);
      }
    }
  });

  it('says the gateway is unreachable even while it still holds an older healthy answer', () => {
    serve({ isError: true, error: unreachable, data: answer(true) });
    render(<GatewayStatusIndicator />);

    expect(indicator()).toHaveTextContent('Gateway unreachable');
    expect(screen.queryByText('Gateway healthy')).not.toBeInTheDocument();
  });

  it('shows nothing until there is an answer', () => {
    serve({});
    render(<GatewayStatusIndicator />);

    expect(
      screen.queryByTestId('gateway-status-indicator'),
    ).not.toBeInTheDocument();
  });

  // A status region only announces what is put into it after it exists, so
  // it is there before there is anything to say, and stays.
  it('announces a change through a status region that is always there', () => {
    serve({});
    const { rerender } = render(<GatewayStatusIndicator />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    serve({ data: answer(true) });
    rerender(<GatewayStatusIndicator />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Gateway healthy');

    serve({ isError: true, error: unreachable, data: answer(true) });
    rerender(<GatewayStatusIndicator />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Gateway unreachable');

    serve({ data: answer(true) });
    rerender(<GatewayStatusIndicator />);
    expect(region).toHaveTextContent('Gateway healthy');
  });
});
