import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import GatewayCompatibilityAlert from '../GatewayCompatibilityAlert';
import { useGatewayInfo } from '../../api/gateway';

// The real hooks and the real REST client, against a BFF in front of a
// gateway that enforces roles. Nothing in the dashboard is mocked: what a
// signed-in user who is not a platform admin gets depends on which route the
// notice asks, and a mocked hook cannot show that.
const mockFetch = jest.fn();

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

// GetGatewayInfo is for platform admins; the gateway refuses it to everyone
// else and the BFF relays the refusal. The health check behind
// /gateway/compatibility has no such rule.
const bffForUserWithoutAdminRole = (url: string) => {
  if (url === '/api/v1/gateway') {
    return Promise.resolve(
      json(403, {
        code: 'permission_denied',
        message: "role 'openshell-admin' required",
      }),
    );
  }
  if (url === '/api/v1/gateway/compatibility') {
    return Promise.resolve(
      json(200, {
        gatewayVersion: '0.0.116',
        compatibility: {
          status: 'unsupported',
          supportedMin: '0.1.0',
          supportedMax: '0.1.2',
        },
      }),
    );
  }
  return Promise.resolve(json(404, { code: 'not_found', message: url }));
};

// Stands in for the shell's About dialog, the other reader of the gateway.
const GatewayInfoProbe: React.FC = () => {
  const gateway = useGatewayInfo();
  return (
    <p data-testid="gateway-info">
      {gateway.isError ? gateway.error.message : gateway.data?.gatewayVersion}
    </p>
  );
};

const renderWithClient = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );

describe('GatewayCompatibilityAlert for a user who is not a platform admin', () => {
  beforeAll(() => {
    global.fetch = mockFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(bffForUserWithoutAdminRole);
  });

  it('shows the notice although the gateway refuses them its info', async () => {
    renderWithClient(
      <>
        <GatewayCompatibilityAlert />
        <GatewayInfoProbe />
      </>,
    );

    // The gateway-info request really is refused for this user...
    await waitFor(() =>
      expect(screen.getByTestId('gateway-info')).toHaveTextContent(
        "role 'openshell-admin' required",
      ),
    );
    // ...and the notice is there all the same, with the version and range.
    const alert = await screen.findByTestId('gateway-compatibility-alert');
    expect(alert).toHaveAttribute('data-status', 'unsupported');
    expect(alert).toHaveTextContent('The gateway reports version 0.0.116.');
    expect(alert).toHaveTextContent(
      'Supported gateway versions: 0.1.0 to 0.1.2.',
    );
  });

  it('asks the route every signed-in user may read, not the admin one', async () => {
    renderWithClient(<GatewayCompatibilityAlert />);
    await screen.findByTestId('gateway-compatibility-alert');

    const requested = mockFetch.mock.calls.map(([url]) => url);
    expect(requested).toEqual(['/api/v1/gateway/compatibility']);
  });
});
