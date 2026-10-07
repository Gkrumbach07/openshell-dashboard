import { useEffect, useRef, useState } from 'react';
import {
  ActionGroup,
  Alert,
  Bullseye,
  Button,
  Checkbox,
  Content,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Spinner,
  Stack,
  StackItem,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { TAB_CONTENT_HEIGHT, TERMINAL_FONT_SIZE } from '../../constants';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { getApiBasePath } from '../../api/client';
import KeyValueEditor from '../KeyValueEditor';
import { isUnsplitCommand, parseCommand } from '../../utils/sandboxOptions';
import {
  DEFAULT_TERMINAL_SESSION_OPTIONS,
  terminalStartMessage,
} from '../../utils/terminalSession';
import type {
  TerminalSessionOptions,
  TerminalStartMessage,
} from '../../utils/terminalSession';
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
  // The socket closed without saying how the session ended: a proxy that
  // timed out, a BFF that went away, a network that dropped.
  const [isCut, setCut] = useState(false);
  // Closes the socket and disposes the terminal of the session that is open.
  const sessionCleanupRef = useRef<(() => void) | null>(null);

  // The options form. They apply to the next session; the one that is open
  // keeps what it started with (startRef).
  const [options, setOptions] = useState<TerminalSessionOptions>(
    DEFAULT_TERMINAL_SESSION_OPTIONS,
  );
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const startRef = useRef<TerminalStartMessage>({ type: 'start' });

  const disconnect = () => {
    sessionCleanupRef.current?.();
    sessionCleanupRef.current = null;
  };

  const connect = () => {
    if (!termRef.current) {
      return;
    }
    disconnect();

    setError(null);
    setExitCode(null);
    setCut(false);
    setConnected(false);

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = getApiBasePath();
    // start=message: the first frame says what to run (see onopen). The
    // options go in a frame, not in this URL, so that environment values
    // stay out of access logs.
    const wsUrl = `${protocol}//${window.location.host}${basePath}/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandboxName)}/terminal?cols=${terminal.cols}&rows=${terminal.rows}&start=message`;

    const ws = new WebSocket(wsUrl);
    // A session that was replaced must not report into the one that
    // replaced it.
    let current = true;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (!current) {
        return;
      }
      ws.send(JSON.stringify(startRef.current));
      setConnected(true);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = (event) => {
      if (!current) {
        return;
      }
      setConnected(false);
      if (!event.reason) {
        // Nothing more will arrive on this socket, so the tab must not go on
        // looking as if it were still connecting.
        setCut(true);
        return;
      }
      // A session that ran closes with its exit code as the reason; one that
      // was refused closes with why.
      if (/^-?\d+$/.test(event.reason)) {
        setExitCode(parseInt(event.reason, 10));
      } else {
        setError(event.reason);
      }
    };

    ws.onerror = () => {
      if (!current) {
        return;
      }
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

    sessionCleanupRef.current = () => {
      current = false;
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  };

  useEffect(() => {
    connect();
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, sandboxName]);

  const startSession = () => {
    const { message, error: startError } = terminalStartMessage(options);
    if (startError) {
      setOptionsError(startError);
      return;
    }
    setOptionsError(null);
    startRef.current = message;
    connect();
  };

  const unsplit = isUnsplitCommand(parseCommand(options.commandText));

  return (
    <Stack hasGutter>
      <StackItem>
        <ExpandableSection
          toggleText="Session options"
          isExpanded={optionsExpanded}
          onToggle={(_event, expanded) => setOptionsExpanded(expanded)}
          data-testid="terminal-options"
        >
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              startSession();
            }}
          >
            <FormGroup label="Command" fieldId="terminal-command">
              <TextArea
                id="terminal-command"
                data-testid="terminal-command-input"
                value={options.commandText}
                onChange={(_event, value) =>
                  setOptions({ ...options, commandText: value })
                }
                rows={2}
                resizeOrientation="vertical"
                className="pf-v6-u-font-family-monospace"
                placeholder="/bin/bash"
              />
              <FormHelperText>
                <HelperText>
                  {unsplit ? (
                    <HelperTextItem
                      variant="warning"
                      data-testid="terminal-command-unsplit"
                    >
                      This is sent as one argument. Put each argument on its own
                      line; no shell splits the command.
                    </HelperTextItem>
                  ) : (
                    <HelperTextItem>
                      What the session runs, one argument per line, like the
                      command of <code>openshell sandbox exec</code>. Leave
                      empty for /bin/bash; use /bin/sh in an image without bash.
                    </HelperTextItem>
                  )}
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Working directory" fieldId="terminal-workdir">
              <TextInput
                id="terminal-workdir"
                data-testid="terminal-workdir-input"
                value={options.workdir}
                onChange={(_event, value) =>
                  setOptions({ ...options, workdir: value })
                }
              />
            </FormGroup>
            <FormGroup
              label="Environment variables"
              fieldId="terminal-env"
              role="group"
            >
              <KeyValueEditor
                rows={options.environmentRows}
                onChange={(rows) =>
                  setOptions({ ...options, environmentRows: rows })
                }
                keyPlaceholder="NAME"
                valuePlaceholder="value"
                testIdPrefix="terminal-env"
                itemLabel="Environment variable"
                addLabel="Add variable"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem
                    variant={optionsError ? 'error' : 'default'}
                    data-testid="terminal-env-help"
                  >
                    {optionsError ??
                      'For this session only. Not for API keys or tokens: attach a provider to the sandbox instead.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup fieldId="terminal-no-login-shell">
              <Checkbox
                id="terminal-no-login-shell"
                data-testid="terminal-no-login-shell"
                label="Skip shell startup files"
                description="Runs the command without sourcing the login and profile files. By default they are sourced, so tool environments such as a Python virtualenv are available."
                isChecked={options.noLoginShell}
                onChange={(_event, checked) =>
                  setOptions({ ...options, noLoginShell: checked })
                }
              />
            </FormGroup>
            <ActionGroup>
              <Button
                type="submit"
                variant="secondary"
                data-testid="terminal-start-session"
              >
                Start new session
              </Button>
            </ActionGroup>
          </Form>
        </ExpandableSection>
      </StackItem>
      {error && (
        <StackItem>
          <Alert
            variant="danger"
            isInline
            title="Terminal error"
            data-testid="terminal-error"
            actionLinks={
              <Button variant="link" onClick={connect}>
                Reconnect
              </Button>
            }
          >
            {error}
          </Alert>
        </StackItem>
      )}
      {isCut && !error && exitCode === null && (
        <StackItem>
          <Alert
            variant="warning"
            isInline
            title="Terminal disconnected"
            data-testid="terminal-cut"
            actionLinks={
              <Button variant="link" onClick={connect}>
                Reconnect
              </Button>
            }
          >
            The connection closed without the session saying how it ended. What
            was running in it may have been stopped.
          </Alert>
        </StackItem>
      )}
      {exitCode !== null && (
        <StackItem>
          <Alert
            variant={exitCode === 0 ? 'success' : 'warning'}
            isInline
            title={`Session ended (exit code ${exitCode})`}
            data-testid="terminal-exit"
            actionLinks={
              <Button variant="link" onClick={connect}>
                Reconnect
              </Button>
            }
          />
        </StackItem>
      )}
      {!connected && !error && !isCut && exitCode === null && (
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
