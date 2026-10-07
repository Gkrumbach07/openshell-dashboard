import { act, fireEvent, render, screen } from '@testing-library/react';
import SandboxTerminalTab from '../sandbox/SandboxTerminalTab';

const disposed: number[] = [];
let terminals = 0;

jest.mock('@xterm/xterm/css/xterm.css', () => ({}), { virtual: true });
jest.mock('@xterm/xterm', () => ({
  Terminal: jest.fn().mockImplementation(() => {
    const id = ++terminals;
    return {
      cols: 80,
      rows: 24,
      loadAddon: jest.fn(),
      open: jest.fn(),
      write: jest.fn(),
      onData: jest.fn(),
      onResize: jest.fn(),
      dispose: () => disposed.push(id),
    };
  }),
}));
jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({ fit: jest.fn() })),
}));
jest.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: jest.fn().mockImplementation(() => ({})),
}));

// The socket the tab opens, driven by hand.
class FakeSocket {
  static OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.sockets.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const lastSocket = () => FakeSocket.sockets[FakeSocket.sockets.length - 1];

beforeEach(() => {
  FakeSocket.sockets = [];
  disposed.length = 0;
  terminals = 0;
  Object.defineProperty(window, 'WebSocket', {
    writable: true,
    value: FakeSocket,
  });
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
});

const renderTab = () =>
  render(<SandboxTerminalTab workspace="team a" sandboxName="agent-1" />);

describe('SandboxTerminalTab', () => {
  it('opens the default shell with a start message and nothing else in the URL', () => {
    renderTab();
    const socket = lastSocket();
    expect(socket.url).toContain(
      '/api/v1/workspaces/team%20a/sandboxes/agent-1/terminal?cols=80&rows=24&start=message',
    );

    act(() => socket.open());
    expect(socket.sent).toEqual([JSON.stringify({ type: 'start' })]);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('starts a new session with the chosen command, directory, environment and login-shell option', () => {
    renderTab();
    const first = lastSocket();
    act(() => first.open());

    fireEvent.click(screen.getByRole('button', { name: 'Session options' }));
    fireEvent.change(screen.getByTestId('terminal-command-input'), {
      target: { value: '/bin/sh\n-l' },
    });
    fireEvent.change(screen.getByTestId('terminal-workdir-input'), {
      target: { value: '/sandbox' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByTestId('terminal-env-key-0'), {
      target: { value: 'MODE' },
    });
    fireEvent.change(screen.getByTestId('terminal-env-value-0'), {
      target: { value: 'ci' },
    });
    fireEvent.click(screen.getByTestId('terminal-no-login-shell'));
    fireEvent.click(screen.getByTestId('terminal-start-session'));

    // The session that was open is closed and its terminal disposed.
    expect(first.closed).toBe(true);
    expect(disposed).toEqual([1]);

    const second = lastSocket();
    expect(second).not.toBe(first);
    // The options are not in the URL.
    expect(second.url).not.toContain('MODE');
    expect(second.url).not.toContain('sandbox%2F');
    act(() => second.open());
    expect(second.sent).toEqual([
      JSON.stringify({
        type: 'start',
        command: ['/bin/sh', '-l'],
        workdir: '/sandbox',
        environment: { MODE: 'ci' },
        noLoginShell: true,
      }),
    ]);
  });

  it('does not start a session while a variable has a value and no name', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByTestId('terminal-env-value-0'), {
      target: { value: 'orphan' },
    });
    fireEvent.click(screen.getByTestId('terminal-start-session'));

    expect(FakeSocket.sockets).toHaveLength(1);
    expect(screen.getByTestId('terminal-env-help')).toHaveTextContent(
      'Every value needs a name',
    );
  });

  it('warns when a whole command line was typed on one line', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }));
    fireEvent.change(screen.getByTestId('terminal-command-input'), {
      target: { value: 'ls -la /tmp' },
    });
    expect(screen.getByTestId('terminal-command-unsplit')).toBeInTheDocument();
  });

  it('reports the exit code of a session that ran', () => {
    renderTab();
    const socket = lastSocket();
    act(() => socket.open());
    act(() => socket.onclose?.({ reason: '127' }));

    expect(screen.getByTestId('terminal-exit')).toHaveTextContent(
      'Session ended (exit code 127)',
    );
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows why a session was refused', () => {
    renderTab();
    const socket = lastSocket();
    act(() => socket.open());
    act(() => socket.onclose?.({ reason: 'failed to open exec stream' }));

    expect(screen.getByTestId('terminal-error')).toHaveTextContent(
      'failed to open exec stream',
    );
    expect(screen.queryByTestId('terminal-exit')).not.toBeInTheDocument();
  });

  it('ignores a replaced session that closes late', () => {
    renderTab();
    const first = lastSocket();
    act(() => first.open());
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }));
    fireEvent.click(screen.getByTestId('terminal-start-session'));
    const second = lastSocket();
    act(() => second.open());

    act(() => first.onclose?.({ reason: '0' }));
    expect(screen.queryByTestId('terminal-exit')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  // A proxy that timed out, a BFF that went away or a network that dropped
  // closes the socket without a reason. Nothing more arrives on it.
  describe('when the connection closes without saying why', () => {
    const connecting = () => screen.queryByLabelText('Connecting to sandbox');

    it('stops looking as if it were connecting, and says the session was cut', () => {
      renderTab();
      const socket = lastSocket();
      expect(connecting()).toBeInTheDocument();
      act(() => socket.open());

      act(() => socket.onclose?.({ reason: '' }));

      expect(connecting()).not.toBeInTheDocument();
      expect(screen.getByTestId('terminal-cut')).toHaveTextContent(
        'Terminal disconnected',
      );
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.queryByTestId('terminal-exit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('terminal-error')).not.toBeInTheDocument();
    });

    it('says the same for a socket that never opened', () => {
      renderTab();
      act(() => lastSocket().onclose?.({ reason: '' }));

      expect(connecting()).not.toBeInTheDocument();
      expect(screen.getByTestId('terminal-cut')).toBeInTheDocument();
    });

    it('offers to reconnect, which starts a session like the one that was cut', () => {
      renderTab();
      const first = lastSocket();
      act(() => first.open());
      act(() => first.onclose?.({ reason: '' }));

      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

      const second = lastSocket();
      expect(second).not.toBe(first);
      expect(screen.queryByTestId('terminal-cut')).not.toBeInTheDocument();
      expect(connecting()).toBeInTheDocument();
      act(() => second.open());
      expect(second.sent[0]).toBe(first.sent[0]);
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('leaves the reason on screen when the connection failed before it closed', () => {
      renderTab();
      const socket = lastSocket();
      act(() => socket.onerror?.());
      act(() => socket.onclose?.({ reason: '' }));

      expect(screen.getByTestId('terminal-error')).toHaveTextContent(
        'Terminal connection failed',
      );
      expect(screen.queryByTestId('terminal-cut')).not.toBeInTheDocument();
    });
  });

  it('offers to reconnect after a session that was refused', () => {
    renderTab();
    const first = lastSocket();
    act(() => first.open());
    act(() => first.onclose?.({ reason: 'failed to open exec stream' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(lastSocket()).not.toBe(first);
    expect(screen.queryByTestId('terminal-error')).not.toBeInTheDocument();
  });
});
