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
import { TAB_CONTENT_HEIGHT, TERMINAL_FONT_SIZE } from '../../constants';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { getApiBasePath } from '../../api/client';
import '@xterm/xterm/css/xterm.css';

// xterm.js theme requires literal color values (rendered on canvas, not CSS).
const TERMINAL_BG = '#1e1e1e';
const TERMINAL_FG = '#d4d4d4';

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
      cursorBlink: false,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.35,
      letterSpacing: 0,
      fontFamily: "'JetBrains Mono', var(--pf-t--global--font--family--mono)",
      theme: {
        background: TERMINAL_BG,
        foreground: TERMINAL_FG,
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(termRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = getApiBasePath();
    const wsUrl = `${protocol}//${window.location.host}${basePath}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandboxName)}/terminal?cols=${terminal.cols}&rows=${terminal.rows}`;

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
            height: TAB_CONTENT_HEIGHT,
            backgroundColor: TERMINAL_BG,
            borderRadius: 'var(--pf-t--global--border--radius--small)',
            padding: 'var(--pf-t--global--spacer--xs)',
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
