import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { getToken } from '../app/authStore';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

type SandboxTerminalTabProps = {
  workspace: string;
  sandboxName: string;
};

const SandboxTerminalTab: React.FC<SandboxTerminalTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const connect = () => {
    if (!termRef.current) {
      return;
    }

    setError(null);
    setExitCode(null);

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'var(--pf-t--global--font--family--mono)',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(termRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken();
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandboxName)}/terminal?cols=${terminal.cols}&rows=${terminal.rows}${tokenParam}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (event.reason) {
        const code = parseInt(event.reason, 10);
        if (!isNaN(code)) {
          setExitCode(code);
        }
      }
    };

    ws.onerror = () => {
      setError('Terminal connection failed');
      setConnected(false);
    };

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  };

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, sandboxName]);

  return (
    <Stack hasGutter>
      {error && (
        <StackItem>
          <Alert variant="danger" isInline title="Terminal error">
            {error}
          </Alert>
        </StackItem>
      )}
      {exitCode !== null && (
        <StackItem>
          <Alert
            variant={exitCode === 0 ? 'success' : 'warning'}
            isInline
            title={`Session ended (exit code ${exitCode})`}
            actionLinks={
              <Button variant="link" onClick={connect}>
                Reconnect
              </Button>
            }
          />
        </StackItem>
      )}
      {!connected && !error && exitCode === null && (
        <StackItem>
          <Bullseye>
            <Spinner aria-label="Connecting to sandbox" />
          </Bullseye>
        </StackItem>
      )}
      <StackItem isFilled>
        <div
          ref={termRef}
          data-testid="terminal-container"
          style={{
            height: '500px',
            backgroundColor: '#1e1e1e',
            borderRadius: '6px',
            padding: '4px',
          }}
        />
      </StackItem>
      <StackItem>
        <Content component="small">
          {connected ? 'Connected' : 'Disconnected'}
        </Content>
      </StackItem>
    </Stack>
  );
};

export default SandboxTerminalTab;
