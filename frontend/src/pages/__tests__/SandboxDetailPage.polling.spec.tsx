import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import SandboxDetailPage from '../SandboxDetailPage';
import { sandboxKeys } from '../../api/queryKeys';
import type { Sandbox } from '../../types';

// The page on a real query client, with only the HTTP call for the sandbox
// stubbed: what is under test is what a poll of the sandbox does to the tabs
// under it, and when the terminal is started.

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ terminal: true })),
}));
jest.mock('../../api/policy', () => ({
  useDraftPolicy: jest.fn(() => ({ data: undefined })),
  useSandboxPolicy: jest.fn(() => ({ data: undefined })),
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
jest.mock('../../components/sandbox/SandboxAttention', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/sandbox/SandboxLogsTab', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/sandbox/SandboxProvidersTab', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/ConnectCard', () => ({
  __esModule: true,
  default: () => null,
}));

// Stands in for the terminal: it counts its sessions as the real tab opens
// and closes them, a WebSocket and a shell on mount and gone on unmount.
const mockTerminal = { opened: [] as string[], closed: 0 };
jest.mock('../../components/sandbox/SandboxTerminalTab', () => ({
  __esModule: true,
  default: ({ sandboxName }: { sandboxName: string }) => {
    jest.requireActual<typeof React>('react').useEffect(() => {
      mockTerminal.opened.push(sandboxName);
      return () => {
        mockTerminal.closed += 1;
      };
    }, [sandboxName]);
    return <div data-testid="terminal-session" />;
  },
}));

// Stands in for a tab that holds something unsaved: the policy editor with a
// document being typed.
jest.mock('../../components/PolicyRuleEditor', () => ({
  __esModule: true,
  default: () => {
    const [draft, setDraft] = jest
      .requireActual<typeof React>('react')
      .useState('');
    return (
      <input
        data-testid="unsaved-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

const sandbox = (name: string): Sandbox => ({
  metadata: { id: `id-${name}`, name, createdAtMs: 1, resourceVersion: 1 },
  spec: {},
  status: { phase: 'READY', currentPolicyVersion: 1 },
});

// What the next request for a sandbox is answered with.
let answer: { status: number; message?: string } = { status: 200 };
const realFetch = global.fetch;

beforeEach(() => {
  answer = { status: 200 };
  mockTerminal.opened = [];
  mockTerminal.closed = 0;
  global.fetch = jest.fn(async (url: string) =>
    answer.status === 200
      ? {
          ok: true,
          status: 200,
          json: async () =>
            sandbox(decodeURIComponent(String(url).split('/').pop() ?? '')),
        }
      : {
          ok: false,
          status: answer.status,
          json: async () => ({ message: answer.message }),
        },
  ) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

const renderPage = (
  entry = '/workspaces/team-a/sandboxes/agent-1',
  sandboxName = 'agent-1',
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const page = (name: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <SandboxDetailPage workspace="team-a" sandboxName={name} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(page(sandboxName));
  return {
    client,
    showSandbox: (name: string) => view.rerender(page(name)),
    // The next poll of the sandbox.
    poll: () =>
      act(async () => {
        await client.refetchQueries({
          queryKey: sandboxKeys.detail('team-a', sandboxName),
        });
      }),
  };
};

const draft = () => screen.getByTestId('unsaved-draft') as HTMLInputElement;

describe('SandboxDetailPage while the sandbox is polled', () => {
  it('keeps every tab, and what is unsaved in them, through a poll that fails', async () => {
    const { poll } = renderPage();
    fireEvent.change(await screen.findByTestId('unsaved-draft'), {
      target: { value: 'unsaved policy edit' },
    });

    answer = { status: 502, message: 'bad gateway' };
    await poll();

    await waitFor(() =>
      expect(screen.getByTestId('sandbox-refresh-error')).toHaveTextContent(
        'bad gateway',
      ),
    );
    expect(draft()).toHaveValue('unsaved policy edit');
    expect(screen.getByTestId('tab-details')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load sandbox agent-1'),
    ).not.toBeInTheDocument();
  });

  it('keeps an open terminal session through a poll that fails', async () => {
    const { poll } = renderPage(
      '/workspaces/team-a/sandboxes/agent-1?tab=terminal',
    );
    await screen.findByTestId('terminal-session');
    expect(mockTerminal.opened).toEqual(['agent-1']);

    answer = { status: 502, message: 'bad gateway' };
    await poll();
    await screen.findByTestId('sandbox-refresh-error');

    expect(mockTerminal.closed).toBe(0);
    expect(mockTerminal.opened).toEqual(['agent-1']);
  });

  it('takes the note away again when a poll gets through', async () => {
    const { poll } = renderPage();
    await screen.findByTestId('unsaved-draft');
    answer = { status: 502, message: 'bad gateway' };
    await poll();
    await screen.findByTestId('sandbox-refresh-error');

    answer = { status: 200 };
    await poll();

    await waitFor(() =>
      expect(
        screen.queryByTestId('sandbox-refresh-error'),
      ).not.toBeInTheDocument(),
    );
  });

  // Not a request that did not get through: the gateway answered, and there
  // is no sandbox left for the tabs to act on.
  it('gives the page up when the gateway says the sandbox is gone', async () => {
    const { poll } = renderPage();
    await screen.findByTestId('unsaved-draft');

    answer = { status: 404, message: 'sandbox not found' };
    await poll();

    await waitFor(() =>
      expect(
        screen.getByText('Sandbox agent-1 no longer exists'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('unsaved-draft')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sandbox-refresh-error'),
    ).not.toBeInTheDocument();
  });

  it('shows the error in place of the page when the sandbox never loaded', async () => {
    answer = { status: 502, message: 'bad gateway' };
    renderPage();

    expect(
      await screen.findByText('Failed to load sandbox agent-1'),
    ).toBeInTheDocument();
    expect(screen.getByText('bad gateway')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-details')).not.toBeInTheDocument();
  });
});

describe('SandboxDetailPage and the terminal', () => {
  it('opens no terminal session for a visit that never shows the Terminal tab', async () => {
    renderPage();
    await screen.findByTestId('tab-details');
    fireEvent.click(screen.getByTestId('tab-logs'));

    expect(mockTerminal.opened).toEqual([]);
    expect(screen.queryByTestId('terminal-session')).not.toBeInTheDocument();
  });

  it('opens one when the Terminal tab is first shown', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('tab-terminal'));

    expect(await screen.findByTestId('terminal-session')).toBeInTheDocument();
    expect(mockTerminal.opened).toEqual(['agent-1']);
  });

  it('opens one at once for a link that goes straight to the Terminal tab', async () => {
    renderPage('/workspaces/team-a/sandboxes/agent-1?tab=terminal');
    expect(await screen.findByTestId('terminal-session')).toBeInTheDocument();
    expect(mockTerminal.opened).toEqual(['agent-1']);
  });

  it('keeps the session open while another tab is looked at', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('tab-terminal'));
    await screen.findByTestId('terminal-session');

    fireEvent.click(screen.getByTestId('tab-details'));
    fireEvent.click(screen.getByTestId('tab-logs'));
    fireEvent.click(screen.getByTestId('tab-terminal'));

    expect(mockTerminal.opened).toEqual(['agent-1']);
    expect(mockTerminal.closed).toBe(0);
  });

  it('closes the session with the sandbox, and opens none for the next one until its tab is shown', async () => {
    const { showSandbox } = renderPage();
    fireEvent.click(await screen.findByTestId('tab-terminal'));
    await screen.findByTestId('terminal-session');
    fireEvent.click(screen.getByTestId('tab-details'));

    showSandbox('agent-2');
    await screen.findByText('agent-2', { selector: 'h1' });

    expect(mockTerminal.closed).toBe(1);
    expect(mockTerminal.opened).toEqual(['agent-1']);
    expect(screen.queryByTestId('terminal-session')).not.toBeInTheDocument();
  });
});
