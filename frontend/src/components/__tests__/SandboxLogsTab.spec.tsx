import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SandboxLogsTab from '../sandbox/SandboxLogsTab';
import type { LogFilters, LogLine, SandboxLogs } from '../../types';

// What the viewer reports about its list, and the list the tab drives.
type MockScroll = {
  scrollOffset: number;
  scrollOffsetToBottom: number;
  scrollUpdateWasRequested: boolean;
};
const mockScrollToBottom = jest.fn();
let mockOnScroll: ((scroll: MockScroll) => void) | undefined;
// The text the tab last handed the viewer, colour sequences and all.
let mockViewerData = '';

// The viewer virtualizes its rows, which jsdom cannot lay out. What is under
// test is the toolbar and what it asks for, what the tab hands the viewer,
// and what it does with what the viewer reports back.
//
// The stand-in draws what the viewer would: the toolbar, each row with its
// line number in the viewer's own markup, and the footer. Like the viewer it
// turns the colour sequences in the text into colour, so they are not part of
// what is read.
jest.mock('@patternfly/react-log-viewer', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const colourSequence = new RegExp(
    `${String.fromCharCode(27)}\\[[0-9;]*m`,
    'g',
  );
  return {
    LogViewer: ({
      toolbar,
      footer,
      data,
      onScroll,
      innerRef,
    }: {
      toolbar: React.ReactNode;
      footer?: React.ReactNode;
      data: string;
      onScroll?: (scroll: MockScroll) => void;
      innerRef?: React.Ref<{ scrollToBottom: () => void }>;
    }) => {
      ReactActual.useImperativeHandle(innerRef, () => ({
        scrollToBottom: mockScrollToBottom,
      }));
      mockOnScroll = onScroll;
      mockViewerData = data;
      const text = data.replace(colourSequence, '');
      return (
        <div>
          {toolbar}
          <pre data-testid="logs-text">{text}</pre>
          <div className="pf-v6-c-log-viewer__list">
            {text.split('\n').map((row, index) => (
              <div
                key={index}
                className="pf-v6-c-log-viewer__list-item"
                data-testid={`log-row-${index + 1}`}
              >
                <span className="pf-v6-c-log-viewer__index">{index + 1}</span>
                <span className="pf-v6-c-log-viewer__text">{row}</span>
              </div>
            ))}
          </div>
          {footer}
        </div>
      );
    },
    LogViewerSearch: ({
      onChange,
      onNextClick,
      onPreviousClick,
    }: {
      onChange?: (event: React.FormEvent, value: string) => void;
      onNextClick?: (event: React.SyntheticEvent) => void;
      onPreviousClick?: (event: React.SyntheticEvent) => void;
    }) => (
      <>
        <input
          aria-label="Search"
          onChange={(event) => onChange?.(event, event.target.value)}
        />
        <button onClick={(event) => onNextClick?.(event)}>Next match</button>
        <button onClick={(event) => onPreviousClick?.(event)}>
          Previous match
        </button>
      </>
    ),
  };
});

jest.mock('../../api/sandboxes', () => ({
  useSandboxLogs: jest.fn(),
}));

import { useSandboxLogs } from '../../api/sandboxes';
const mockUseSandboxLogs = useSandboxLogs as jest.Mock;

const serve = (logs: SandboxLogs) =>
  mockUseSandboxLogs.mockReturnValue({
    isLoading: false,
    isError: false,
    data: logs,
    refetch: jest.fn(),
  });

const someLogs: SandboxLogs = {
  bufferTotal: 200,
  logs: [
    {
      timestampMs: 1_760_000_000_000,
      level: 'INFO',
      source: 'sandbox',
      message: 'hello',
    },
  ],
};

// The filters and the auto-refresh flag of the latest request.
const lastRequest = (): { filters: LogFilters; autoRefresh: boolean } => {
  const [workspace, sandbox, filters, autoRefresh] =
    mockUseSandboxLogs.mock.calls[mockUseSandboxLogs.mock.calls.length - 1];
  expect([workspace, sandbox]).toEqual(['team-a', 'agent']);
  return { filters, autoRefresh };
};

const renderTab = () =>
  render(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);

const sinceBox = () => screen.getByTestId('logs-since-input');

const typeSince = (value: string) =>
  fireEvent.change(sinceBox(), { target: { value } });

describe('SandboxLogsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serve(someLogs);
  });

  it('asks for the last 200 lines of every level and source by default', () => {
    renderTab();

    expect(lastRequest()).toEqual({
      filters: {
        lines: 200,
        level: undefined,
        sources: undefined,
        sinceDurationMs: undefined,
      },
      autoRefresh: true,
    });
    expect(sinceBox()).toHaveValue('');
    expect(screen.queryByTestId('logs-since-note')).not.toBeInTheDocument();
  });

  // `openshell logs --since 5m`. The tab asks for a window that ends now,
  // not for a fixed point in time, so that every refresh moves it forward.
  it.each([
    ['30s', 30_000],
    ['5m', 300_000],
    ['1h', 3_600_000],
  ])('asks for the logs of the last %s', (typed, sinceDurationMs) => {
    renderTab();

    typeSince(typed);

    expect(lastRequest().filters.sinceDurationMs).toBe(sinceDurationMs);
    expect(lastRequest().filters.sinceMs).toBeUndefined();
    expect(sinceBox()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('does not apply something that is not a duration, and says why', () => {
    renderTab();

    typeSince('5 minutes');

    expect(lastRequest().filters.sinceDurationMs).toBeUndefined();
    expect(sinceBox()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('logs-since-note')).toHaveTextContent(
      'Since takes a whole number and a unit: 30s, 5m or 1h. It is not applied.',
    );
  });

  // The gateway filters the lines it was asked for, not everything the
  // sandbox ever logged. The CLI prints the same warning with --since.
  it('warns that a window is searched in the returned lines only', () => {
    renderTab();

    typeSince('5m');

    expect(screen.getByTestId('logs-since-note')).toHaveTextContent(
      'Only the last 200 log lines were searched, so results for this window may be incomplete.',
    );
  });

  it('says to raise the line count while there is a larger one to pick', () => {
    renderTab();

    typeSince('5m');

    expect(screen.getByTestId('logs-since-note')).toHaveTextContent(
      'Raise the line count to search further back.',
    );
  });

  it('does not say so at the largest line count', () => {
    serve({ bufferTotal: 2000, logs: someLogs.logs });
    renderTab();
    fireEvent.change(screen.getByTestId('logs-lines-select'), {
      target: { value: '2000' },
    });

    typeSince('5m');

    const note = screen.getByTestId('logs-since-note');
    expect(note).toHaveTextContent(
      'Only the last 2000 log lines were searched, so results for this window may be incomplete.',
    );
    expect(note).not.toHaveTextContent('Raise the line count');
  });

  // Fewer lines than were asked for means the gateway searched everything it
  // holds: there is nothing further back to miss.
  it.each([
    ['fewer lines than were asked for', 36],
    ['no lines at all', 0],
  ])('does not warn when the gateway searched %s', (_name, bufferTotal) => {
    serve({ bufferTotal, logs: [] });
    renderTab();

    typeSince('5m');

    expect(screen.queryByTestId('logs-since-note')).not.toBeInTheDocument();
  });

  it('combines the window with the other filters', () => {
    renderTab();

    fireEvent.change(screen.getByTestId('logs-level-select'), {
      target: { value: 'WARN' },
    });
    fireEvent.change(screen.getByTestId('logs-source-select'), {
      target: { value: 'gateway' },
    });
    fireEvent.change(screen.getByTestId('logs-lines-select'), {
      target: { value: '2000' },
    });
    typeSince('1h');

    expect(lastRequest().filters).toEqual({
      lines: 2000,
      level: 'WARN',
      sources: ['gateway'],
      sinceDurationMs: 3_600_000,
    });
  });

  // The CLI's --level takes error, warn, info, debug and trace.
  it('offers every level the gateway filters on, trace included', () => {
    renderTab();
    const options = Array.from(
      (screen.getByTestId('logs-level-select') as HTMLSelectElement).options,
    ).map((option) => option.value);

    expect(options).toEqual(['', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']);

    fireEvent.change(screen.getByTestId('logs-level-select'), {
      target: { value: 'TRACE' },
    });
    expect(lastRequest().filters.level).toBe('TRACE');
  });

  it('clears the window along with the other filters', () => {
    renderTab();
    expect(screen.queryByTestId('logs-clear-filters')).not.toBeInTheDocument();

    typeSince('5m');
    fireEvent.click(screen.getByTestId('logs-clear-filters'));

    expect(sinceBox()).toHaveValue('');
    expect(lastRequest().filters.sinceDurationMs).toBeUndefined();
    expect(screen.queryByTestId('logs-clear-filters')).not.toBeInTheDocument();
  });

  // Polling is how the tab follows a log: there is no stream through the BFF.
  it('keeps polling unless auto-refresh is switched off', () => {
    renderTab();
    typeSince('5m');
    expect(lastRequest().autoRefresh).toBe(true);

    fireEvent.click(screen.getByTestId('logs-auto-refresh'));

    expect(lastRequest().autoRefresh).toBe(false);
    expect(lastRequest().filters.sinceDurationMs).toBe(300_000);
  });

  it('shows the lines it was given', () => {
    renderTab();
    expect(screen.getByTestId('logs-text')).toHaveTextContent(
      'INFO [sandbox] hello',
    );
  });

  // What a line of `openshell logs` carries: level, source, target, message
  // and the structured fields.
  it('shows the target and the fields of a line', () => {
    serve({
      bufferTotal: 1,
      logs: [
        {
          timestampMs: 1_760_000_000_000,
          level: 'warn',
          source: 'sandbox',
          target: 'example::target',
          message: 'connection denied',
          fields: { action: 'deny', dst_host: 'example.com' },
        },
      ],
    });
    renderTab();

    expect(screen.getByTestId('logs-text')).toHaveTextContent(
      'WARN [sandbox] [example::target] connection denied action=deny dst_host=example.com',
    );
  });
});

const logLine = (message: string, more: Partial<LogLine> = {}): LogLine => ({
  timestampMs: 1_760_000_000_000,
  level: 'INFO',
  source: 'gateway',
  message,
  ...more,
});

const serveLines = (...logs: LogLine[]) =>
  serve({ bufferTotal: logs.length, logs });

// The list scrolled by the user to a place that many pixels from its end.
const userScrollsTo = (scrollOffsetToBottom: number) =>
  act(() =>
    mockOnScroll?.({
      scrollOffset: 500,
      scrollOffsetToBottom,
      scrollUpdateWasRequested: false,
    }),
  );

const followStatus = () => screen.getByTestId('logs-follow-status');
const jumpToLatest = () => screen.getByTestId('logs-jump-to-latest');

// What the upstream TUI's log view does and the tab did not: it colours the
// level and the sandbox source, and puts the fields of a network decision in
// an order that reads.
describe('SandboxLogsTab rows', () => {
  const ESC = String.fromCharCode(27);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('colours ERROR, WARN and INFO and accents the sandbox source', () => {
    serveLines(
      logLine('boom', { level: 'ERROR' }),
      logLine('careful', { level: 'WARN' }),
      logLine('fine', { level: 'INFO', source: 'sandbox' }),
      logLine('quiet', { level: 'DEBUG' }),
    );
    renderTab();

    // The viewer is handed the colours as ANSI sequences, which it renders.
    const rows = mockViewerData.split('\n');
    expect(rows[0]).toContain(`${ESC}[91mERROR${ESC}[0m [gateway]`);
    expect(rows[1]).toContain(`${ESC}[33mWARN${ESC}[0m [gateway]`);
    expect(rows[2]).toContain(
      `${ESC}[32mINFO${ESC}[0m ${ESC}[36m[sandbox]${ESC}[0m`,
    );
    expect(rows[3]).not.toContain(ESC);
    // What is read is the same text as before.
    expect(screen.getByTestId('log-row-1')).toHaveTextContent(
      'ERROR [gateway] boom',
    );
    expect(screen.getByTestId('log-row-3')).toHaveTextContent(
      'INFO [sandbox] fine',
    );
  });

  it('puts the fields of a CONNECT line in the order they are read in and leaves out the empty ones', () => {
    serveLines(
      logLine('CONNECT', {
        fields: {
          reason: '',
          binary: '/usr/bin/curl',
          src_addr: '10.0.0.2',
          dst_port: '443',
          action: 'deny',
          dst_host: 'example.com',
          zz_extra: 'last',
          policy: '',
        },
      }),
    );
    renderTab();

    expect(screen.getByTestId('log-row-1')).toHaveTextContent(
      'CONNECT action=deny dst_host=example.com dst_port=443 src_addr=10.0.0.2 binary=/usr/bin/curl zz_extra=last',
    );
    expect(screen.getByTestId('log-row-1')).not.toHaveTextContent('reason=');
    expect(screen.getByTestId('log-row-1')).not.toHaveTextContent('policy=');
  });

  it('puts the fields of an L7_REQUEST line in their own order', () => {
    serveLines(
      logLine('L7_REQUEST', {
        fields: {
          policy: 'default',
          dst_host: 'api.example.com',
          l7_target: '/v1/models',
          l7_action: 'GET',
          l7_decision: 'allow',
        },
      }),
    );
    renderTab();

    expect(screen.getByTestId('log-row-1')).toHaveTextContent(
      'L7_REQUEST l7_action=GET l7_target=/v1/models l7_decision=allow dst_host=api.example.com policy=default',
    );
  });

  it('sorts the fields of any other line by name', () => {
    serveLines(
      logLine('Fetching sandbox policy via gRPC', {
        fields: { sandbox_id: 'abc', endpoint: 'http://gw', sandbox: 'agent' },
      }),
    );
    renderTab();

    expect(screen.getByTestId('log-row-1')).toHaveTextContent(
      'Fetching sandbox policy via gRPC endpoint=http://gw sandbox=agent sandbox_id=abc',
    );
  });

  // The gateway sends a line without fields as "fields": null.
  it('shows a line whose fields are null', () => {
    serveLines({ ...logLine('no fields'), fields: null } as unknown as LogLine);
    renderTab();

    expect(screen.getByTestId('log-row-1')).toHaveTextContent(
      'INFO [gateway] no fields',
    );
  });
});

// The TUI follows the newest line, pauses when the user scrolls up, and goes
// back to the newest line on demand. The tab still polls for the lines; what
// is under test is where the view is put when they arrive.
describe('SandboxLogsTab follow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveLines(logLine('one'), logLine('two'));
  });

  it('follows the newest line to begin with', () => {
    renderTab();

    expect(followStatus()).toHaveTextContent('Following');
    expect(screen.queryByTestId('logs-paused-reason')).not.toBeInTheDocument();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    // There is nowhere to jump to from the newest line.
    expect(jumpToLatest()).toHaveAttribute('aria-disabled', 'true');
  });

  it('goes to the newest line again whenever the lines change', () => {
    const { rerender } = renderTab();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);

    // A refresh that brought nothing new moves nothing.
    rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);

    serveLines(logLine('one'), logLine('two'), logLine('three'));
    rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);
    expect(mockScrollToBottom).toHaveBeenCalledTimes(2);
    expect(followStatus()).toHaveTextContent('Following');
  });

  it('pauses when the user scrolls away from the newest line, and stays where it is', () => {
    const { rerender } = renderTab();
    mockScrollToBottom.mockClear();

    userScrollsTo(400);

    expect(followStatus()).toHaveTextContent('Paused');
    expect(screen.getByTestId('logs-paused-reason')).toHaveTextContent(
      'Scrolled away from the newest line.',
    );
    expect(jumpToLatest()).not.toHaveAttribute('aria-disabled', 'true');

    // New lines still arrive, and the view is left alone.
    serveLines(logLine('one'), logLine('two'), logLine('three'));
    rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);
    expect(screen.getByTestId('log-row-3')).toHaveTextContent('three');
    expect(mockScrollToBottom).not.toHaveBeenCalled();
    expect(followStatus()).toHaveTextContent('Paused');
  });

  it('follows again once the user scrolls back to the newest line', () => {
    renderTab();
    userScrollsTo(400);
    mockScrollToBottom.mockClear();

    userScrollsTo(0);

    expect(followStatus()).toHaveTextContent('Following');
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  // A zoomed page reports its positions in fractions, so the end of the list
  // is rarely exactly zero pixels away.
  it.each([
    [0.5, 'Following'],
    [8, 'Following'],
    [9, 'Paused'],
  ])('reads %s pixels from the end as %s', (offset, status) => {
    renderTab();

    userScrollsTo(offset);

    expect(followStatus()).toHaveTextContent(status);
  });

  it('jumps back to the newest line on demand', () => {
    renderTab();
    userScrollsTo(400);
    mockScrollToBottom.mockClear();

    fireEvent.click(jumpToLatest());

    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    expect(followStatus()).toHaveTextContent('Following');
    expect(screen.queryByTestId('logs-paused-reason')).not.toBeInTheDocument();
  });

  // The view is moved by the tab itself on every refresh. That is not the
  // user scrolling away, wherever it leaves the view.
  it('is not paused by a scroll it asked for itself', () => {
    renderTab();

    act(() =>
      mockOnScroll?.({
        scrollOffset: 120,
        scrollOffsetToBottom: 400,
        scrollUpdateWasRequested: true,
      }),
    );

    expect(followStatus()).toHaveTextContent('Following');
  });

  // The viewer builds its list anew when the page is resized, and a new list
  // starts at its top. It says so with an offset of 0 and no measure of how
  // far the end is.
  it('goes to the newest line of a list the viewer has just built', () => {
    renderTab();
    mockScrollToBottom.mockClear();
    const newList = {
      scrollOffset: 0,
      scrollOffsetToBottom: -1,
      scrollUpdateWasRequested: false,
    };

    act(() => mockOnScroll?.(newList));
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    expect(followStatus()).toHaveTextContent('Following');

    // A paused view is not moved, and a new list does not un-pause it.
    userScrollsTo(400);
    mockScrollToBottom.mockClear();
    act(() => mockOnScroll?.(newList));
    expect(mockScrollToBottom).not.toHaveBeenCalled();
    expect(followStatus()).toHaveTextContent('Paused');
  });

  it('says it is paused while auto-refresh is off, and why', () => {
    renderTab();

    fireEvent.click(screen.getByTestId('logs-auto-refresh'));

    expect(followStatus()).toHaveTextContent('Paused');
    expect(screen.getByTestId('logs-paused-reason')).toHaveTextContent(
      'Auto-refresh is off.',
    );
    // The view is still at the newest line it has.
    expect(jumpToLatest()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByTestId('logs-auto-refresh'));
    expect(followStatus()).toHaveTextContent('Following');
  });

  // A search moves the view to what it found. Following on would take it
  // away again at the next refresh.
  it.each([
    [
      'typing a search',
      () =>
        fireEvent.change(screen.getByLabelText('Search'), {
          target: { value: 'two' },
        }),
    ],
    ['the next match', () => fireEvent.click(screen.getByText('Next match'))],
    [
      'the previous match',
      () => fireEvent.click(screen.getByText('Previous match')),
    ],
  ])('pauses for %s', (_name, search) => {
    renderTab();

    search();

    expect(followStatus()).toHaveTextContent('Paused');
  });

  it('starts at the newest line again when a filter changes', () => {
    renderTab();
    userScrollsTo(400);
    expect(followStatus()).toHaveTextContent('Paused');

    fireEvent.change(screen.getByTestId('logs-level-select'), {
      target: { value: 'WARN' },
    });

    expect(followStatus()).toHaveTextContent('Following');
  });

  it('announces the follow state as a status', () => {
    renderTab();

    expect(followStatus()).toHaveAttribute('role', 'status');
  });
});

// Enter on a line in the TUI opens everything the line carries. Here a click
// on the row does, and so does the line's number from the keyboard.
describe('SandboxLogsTab line details', () => {
  const connect = logLine('CONNECT', {
    level: 'WARN',
    source: 'sandbox',
    target: 'openshell_supervisor_network::proxy',
    fields: {
      reason: '',
      cmdline: 'curl https://example.com',
      dst_host: 'example.com',
      action: 'deny',
    },
  });

  const detail = () => screen.getByTestId('log-line-detail');
  const lineNumber = () => screen.getByTestId('logs-line-number');
  const viewDetails = () => screen.getByTestId('logs-line-details');
  // Term and description of every entry of a description list, in order.
  const entries = (list: HTMLElement): string[][] =>
    Array.from(list.querySelectorAll('dt')).map((term) => [
      term.textContent ?? '',
      term.nextElementSibling?.textContent ?? '',
    ]);

  beforeEach(() => {
    jest.clearAllMocks();
    window.getSelection()?.removeAllRanges();
    serveLines(logLine('plain'), connect, logLine('last'));
  });

  it('opens the details of the row that is clicked', () => {
    renderTab();
    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();

    fireEvent.click(
      screen
        .getByTestId('log-row-2')
        .querySelector('.pf-v6-c-log-viewer__text') as Element,
    );

    expect(detail()).toHaveAttribute('role', 'dialog');
    expect(detail()).toHaveAccessibleName('Log line details');
    expect(detail()).toHaveTextContent('Line 2 of 3');
    expect(screen.getByTestId('log-detail-time')).toHaveTextContent(
      new Date(1_760_000_000_000).toLocaleString(),
    );
    expect(screen.getByTestId('log-detail-source')).toHaveTextContent(
      'sandbox',
    );
    expect(screen.getByTestId('log-detail-level')).toHaveTextContent('WARN');
    expect(screen.getByTestId('log-detail-target')).toHaveTextContent(
      'openshell_supervisor_network::proxy',
    );
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent(
      'CONNECT',
    );
    // The fields in the order the row has them, without the empty one.
    expect(entries(screen.getByTestId('log-detail-fields'))).toEqual([
      ['action', 'deny'],
      ['dst_host', 'example.com'],
      ['cmdline', 'curl https://example.com'],
    ]);
  });

  it('opens them for a click on the line number as well', () => {
    renderTab();

    fireEvent.click(
      screen
        .getByTestId('log-row-3')
        .querySelector('.pf-v6-c-log-viewer__index') as Element,
    );

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('last');
  });

  it('shows no target and no fields for a line that has neither', () => {
    renderTab();

    fireEvent.click(screen.getByTestId('log-row-1'));

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('plain');
    expect(screen.getByTestId('log-detail-source')).toHaveTextContent(
      'gateway',
    );
    expect(screen.queryByTestId('log-detail-target')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-detail-fields')).not.toBeInTheDocument();
  });

  it('closes again', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('log-row-1'));

    fireEvent.click(screen.getByTestId('log-detail-close'));

    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
  });

  // A row cannot take focus, so the keyboard gets there by the line's number,
  // which the viewer shows in front of every row.
  it('opens the details of a line by its number, from the keyboard', () => {
    renderTab();
    expect(lineNumber()).toHaveAccessibleName('Line number');
    expect(lineNumber()).toHaveAccessibleDescription(
      'Click a line or enter its number to see its details.',
    );
    expect(viewDetails()).toBeDisabled();

    fireEvent.change(lineNumber(), { target: { value: '2' } });
    fireEvent.keyDown(lineNumber(), { key: 'Enter' });

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent(
      'CONNECT',
    );
  });

  it('opens them with the button next to the number', () => {
    renderTab();

    fireEvent.change(lineNumber(), { target: { value: '3' } });
    expect(viewDetails()).toBeEnabled();
    fireEvent.click(viewDetails());

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('last');
    expect(detail()).toHaveTextContent('Line 3 of 3');
  });

  it.each(['0', '4', '-1', '1.5', 'two', ' '])(
    'opens nothing for "%s", which is no line',
    (typed) => {
      renderTab();

      fireEvent.change(lineNumber(), { target: { value: typed } });
      fireEvent.keyDown(lineNumber(), { key: 'Enter' });

      expect(viewDetails()).toBeDisabled();
      expect(lineNumber()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
    },
  );

  it('does not mark an empty number as wrong', () => {
    renderTab();

    expect(lineNumber()).not.toHaveAttribute('aria-invalid', 'true');
    expect(viewDetails()).toBeDisabled();
  });

  it('steps to the line before and the line after', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('log-row-2'));
    const previous = () => screen.getByTestId('log-detail-previous');
    const next = () => screen.getByTestId('log-detail-next');

    fireEvent.click(next());
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('last');
    expect(detail()).toHaveTextContent('Line 3 of 3');
    // There is no line after the last one.
    expect(next()).toBeDisabled();

    fireEvent.click(previous());
    fireEvent.click(previous());
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('plain');
    expect(detail()).toHaveTextContent('Line 1 of 3');
    expect(previous()).toBeDisabled();
  });

  // The log keeps refreshing behind the dialog. What is open, and the lines
  // around it, are the ones that were there when it was opened.
  it('keeps the open line and its neighbours when new lines arrive', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId('log-row-2'));

    serveLines(logLine('shifted in'), logLine('another'), logLine('newest'));
    rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent(
      'CONNECT',
    );
    fireEvent.click(screen.getByTestId('log-detail-next'));
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('last');
  });

  // A message that spans lines takes a row for each. Every one of them opens
  // the same line, and the lines after it are found by their own rows.
  it('opens the line a row belongs to when a message spans rows', () => {
    serveLines(
      logLine('first'),
      logLine('panicked\n  at src/main.rs\n  note: backtrace'),
      logLine('after'),
    );
    renderTab();

    fireEvent.click(screen.getByTestId('log-row-3'));
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent(
      'panicked at src/main.rs note: backtrace',
    );
    // The number is the one in front of the line's first row.
    expect(detail()).toHaveTextContent('Line 2 of 5');
    fireEvent.click(screen.getByTestId('log-detail-close'));

    fireEvent.click(screen.getByTestId('log-row-5'));
    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('after');
    expect(detail()).toHaveTextContent('Line 5 of 5');
  });

  // Selecting text to copy it ends in a click too.
  it('leaves a click alone that ends a text selection', () => {
    renderTab();
    const text = screen
      .getByTestId('log-row-2')
      .querySelector('.pf-v6-c-log-viewer__text') as Element;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);

    fireEvent.click(text);

    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
  });

  it('opens nothing for a click that is not on a row', () => {
    renderTab();

    fireEvent.click(screen.getByTestId('logs-footer'));
    fireEvent.click(screen.getByTestId('logs-level-select'));

    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
  });

  it('has no lines to open while none match', () => {
    serveLines();
    renderTab();

    fireEvent.click(screen.getByTestId('log-row-1'));
    fireEvent.change(lineNumber(), { target: { value: '1' } });

    expect(screen.getByTestId('logs-text')).toHaveTextContent(
      'No log lines match the current filters.',
    );
    expect(viewDetails()).toBeDisabled();
    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
  });

  it('names the two ways to step in the dialog', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('log-row-2'));

    const dialog = within(detail());
    expect(dialog.getByRole('button', { name: 'Previous line' })).toBeEnabled();
    expect(dialog.getByRole('button', { name: 'Next line' })).toBeEnabled();
  });
});

// The logs are polled. React Query reports a refetch that failed as an error
// beside the data of the last fetch that worked, and a fetch that never
// worked for the filters in force as an error without data.
describe('SandboxLogsTab when a request fails', () => {
  const refetch = jest.fn();
  const fail = (data?: SandboxLogs) =>
    mockUseSandboxLogs.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('bad gateway'),
      data,
      refetch,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    serve(someLogs);
  });

  it('keeps the lines of the last refresh that worked, with a note that they may be out of date', () => {
    const view = renderTab();
    fail(someLogs);
    view.rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);

    expect(screen.getByTestId('logs-refresh-error')).toHaveTextContent(
      'bad gateway',
    );
    expect(screen.getByTestId('logs-text')).toHaveTextContent(
      'INFO [sandbox] hello',
    );
    expect(screen.queryByTestId('logs-load-error')).not.toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('logs-refresh-error')).getByRole('button', {
        name: 'Retry',
      }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the details of a line open through a refresh that fails', () => {
    const view = renderTab();
    fireEvent.click(screen.getByTestId('log-row-1'));
    expect(screen.getByTestId('log-line-detail')).toBeInTheDocument();

    fail(someLogs);
    view.rerender(<SandboxLogsTab workspace="team-a" sandboxName="agent" />);

    expect(screen.getByTestId('log-detail-message')).toHaveTextContent('hello');
  });

  // The filters are in the viewer's toolbar. Taking the viewer away with the
  // error would leave no way to change a filter the gateway cannot answer.
  it('keeps the filters within reach when the logs never loaded, and says why there are none', () => {
    fail();
    renderTab();

    expect(screen.getByTestId('logs-load-error')).toHaveTextContent(
      'bad gateway',
    );
    expect(screen.getByText('Failed to load logs')).toBeInTheDocument();
    expect(screen.queryByTestId('logs-refresh-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('logs-text')).toHaveTextContent(
      'The logs could not be loaded.',
    );

    // A filter can still be changed, and is asked for.
    fireEvent.change(screen.getByTestId('logs-level-select'), {
      target: { value: 'ERROR' },
    });
    expect(lastRequest().filters.level).toBe('ERROR');

    fireEvent.click(
      within(screen.getByTestId('logs-load-error')).getByRole('button', {
        name: 'Retry',
      }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens no line details for the row that says the logs could not be loaded', () => {
    fail();
    renderTab();
    fireEvent.click(screen.getByTestId('log-row-1'));
    expect(screen.queryByTestId('log-line-detail')).not.toBeInTheDocument();
  });
});
