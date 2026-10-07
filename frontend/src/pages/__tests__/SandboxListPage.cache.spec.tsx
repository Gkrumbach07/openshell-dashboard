import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import SandboxListPage from '../SandboxListPage';
import { sandboxKeys } from '../../api/queryKeys';
import type { Sandbox } from '../../types';

// The list on a real query client, with only the HTTP calls stubbed: what is
// under test is which cache entry the list reads.

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ terminal: true, draftPolicy: false })),
}));
jest.mock('../../api/policy', () => ({
  useSandboxPolicies: jest.fn(() => ({})),
}));
jest.mock('../../api/draftSummary', () => ({
  useWorkspaceDraftSummary: jest.fn(() => ({ items: [], bySandbox: {} })),
}));
jest.mock('../../api/providers', () => ({
  useProviderExpiry: jest.fn(() => ({})),
}));
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));
jest.mock('../../components/CreateSandboxModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../slots', () => ({ useSlots: () => ({}) }));

const sandbox = (name: string): Sandbox => ({
  metadata: { id: `id-${name}`, name, createdAtMs: 1, resourceVersion: 1 },
  spec: { policy: {} },
  status: { phase: 'READY', currentPolicyVersion: 1 },
});

// Catches what a render throws, as nothing in the app does.
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? (
      <div data-testid="crashed">{this.state.error.message}</div>
    ) : (
      this.props.children
    );
  }
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('SandboxListPage and the sandbox cache', () => {
  // The label selector box sits beside the name filter. A sandbox's name
  // typed into it used to be the cache key of that sandbox's detail page.
  it('does not read a sandbox that was looked at as the list for a selector that is its name', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // As a visit to the detail page of "web" leaves it, for five minutes.
    client.setQueryData(sandboxKeys.detail('team-a', 'web'), sandbox('web'));

    const fetchMock = jest.fn(async (url: string) =>
      String(url).includes('labelSelector=')
        ? {
            ok: false,
            status: 400,
            json: async () => ({ message: "invalid label selector 'web'" }),
          }
        : {
            ok: true,
            status: 200,
            json: async () => [sandbox('web'), sandbox('db')],
          },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Boundary>
            <SandboxListPage workspace="team-a" />
          </Boundary>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('sandbox-table')).toBeInTheDocument(),
    );

    const input = within(
      screen.getByTestId('sandbox-label-selector'),
    ).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'web' } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Apply label selector' }),
      );
    });

    // The gateway's refusal of the selector, beside the filter; not a crash.
    expect(
      await screen.findByTestId('sandbox-label-selector-error'),
    ).toHaveTextContent("invalid label selector 'web'");
    expect(screen.queryByTestId('crashed')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes?labelSelector=web',
      expect.anything(),
    );
    // And the sandbox that was looked at is still what its own key holds.
    expect(client.getQueryData(sandboxKeys.detail('team-a', 'web'))).toEqual(
      sandbox('web'),
    );
  });
});
