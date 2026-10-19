import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LOG_LINES,
  SANDBOX_POLL_MS,
  TAB_CONTENT_HEIGHT,
} from '../../constants';
import {
  Alert,
  Button,
  Checkbox,
  Content,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { ArrowDownIcon } from '@patternfly/react-icons';
import { LogViewer, LogViewerSearch } from '@patternfly/react-log-viewer';

import { useSandboxLogs, watchSandboxLogs } from '../../api/sandboxes';
import { useTheme } from '../../app/theme';
import { useI18n } from '../../i18n';
import LogLineDetailModal from '../LogLineDetailModal';
import RefreshErrorAlert from '../RefreshErrorAlert';
import { parseSinceDuration } from '../../utils/duration';
import { buildLogRows, logViewerRowOf } from '../../utils/logLines';
import type { LogLine } from '../../types';

type SandboxLogsTabProps = {
  workspace: string;
  sandboxName: string;
  isActive?: boolean;
};

// Bound retained history as well as the largest line count the tab offers.
const MAX_LOG_LINES = 2000;
const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

// How far from the end of the log, in pixels, still counts as being at it. A
// zoomed page reports positions in fractions, so the end is rarely exactly 0.
const TAIL_TOLERANCE_PX = 8;

// The part of the log viewer's list this tab drives.
type LogViewerList = {
  scrollToBottom: () => void;
};

// What the viewer reports about its list: once when it builds the list, and
// then whenever the list is scrolled.
type LogViewerScroll = {
  scrollOffset: number;
  scrollOffsetToBottom: number;
  scrollUpdateWasRequested: boolean;
};

// The report of a list that has just been built. It starts at its top and has
// not measured how far that is from its end, which it reports as -1.
const isNewList = ({ scrollOffset, scrollOffsetToBottom }: LogViewerScroll) =>
  scrollOffset === 0 && scrollOffsetToBottom === -1;

// The line whose details are open, with the lines it was among when it was
// opened. New lines keep arriving while the dialog is open, and stepping to
// the line before or after must not land somewhere else because of them.
type OpenLine = {
  lines: LogLine[];
  lineOfRow: number[];
  index: number;
};

const enum Transport {
  Stream = 'stream',
  Poll = 'poll',
}

const SandboxLogsTab: React.FC<SandboxLogsTabProps> = ({
  workspace,
  sandboxName,
  isActive = true,
}) => {
  const { t } = useI18n();
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [lines, setLines] = useState(DEFAULT_LOG_LINES);
  // What `openshell logs --since` takes: 30s, 5m, 1h. Empty is no limit.
  const [since, setSince] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [receivedLines, setReceivedLines] = useState<LogLine[]>([]);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<Error | null>(null);
  const [pollingFailure, setPollingFailure] = useState<Error | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  // Whether the view is at the newest line. While it is, each update brings
  // the new newest line into view; scrolling away from it lets go.
  const [isAtTail, setAtTail] = useState(true);
  // Counts the lists the viewer has built. It builds a new one when it first
  // has room to draw in and whenever the page is resized.
  const [listGeneration, setListGeneration] = useState(0);
  const [lineNumber, setLineNumber] = useState('');
  const [openLine, setOpenLine] = useState<OpenLine | null>(null);
  // transport type (streaming, polling) for logs
  const [transport, setTransport] = useState<Transport>(Transport.Stream);
  const viewerList = useRef<LogViewerList | null>(null);
  const lineHelpId = useId();
  // The viewer was fixed to its dark theme, which on a light page is a black
  // slab. It takes exactly the two values the dashboard theme has.
  const { theme } = useTheme();
  const sinceDurationMs = parseSinceDuration(since);
  const sinceIsInvalid = since.trim() !== '' && sinceDurationMs === undefined;

  const polling = useSandboxLogs(
    workspace,
    sandboxName,
    {
      lines: Number(lines),
      level: level || undefined,
      sources: source ? [source] : undefined,
      sinceDurationMs,
    },
    autoRefresh,
    transport === Transport.Poll && autoRefresh && pollingFailure === null,
  );

  // Keep the failure across filter changes and auto-refresh toggles. Only
  // Retry may start requests again, even if a different query key is selected.
  useEffect(() => {
    if (transport === Transport.Poll && polling.error) {
      setPollingFailure(polling.error);
    }
  }, [transport, polling.error]);

  const displayLines: LogLine[] =
    transport === Transport.Poll
      ? (polling.data?.logs ?? receivedLines)
      : receivedLines;

  useEffect(() => {
    setReceivedLines([]);
    setStreamWarning(null);
    setStreamError(null);
    setPollingFailure(null);
    setOpenLine(null);
    setAtTail(true);
  }, [workspace, sandboxName]);

  useEffect(() => {
    if (!autoRefresh || transport !== Transport.Stream) {
      return;
    }

    // A new subscription replays the tail. Replace, rather than append to,
    // the previous subscription's history so reconnects do not duplicate it.
    setReceivedLines([]);
    setStreamWarning(null);
    setStreamError(null);
    let active = true;
    let stop: (() => void) | undefined;

    const fallbackToPolling = (error: Error) => {
      if (!active) {
        return;
      }
      setStreamError(error);
      setTransport(Transport.Poll);
    };

    try {
      stop = watchSandboxLogs(
        workspace,
        sandboxName,
        MAX_LOG_LINES,
        (line) => {
          if (active) {
            setReceivedLines((previous) =>
              [...previous, line].slice(-MAX_LOG_LINES),
            );
          }
        },
        (warning: unknown) => {
          if (!active) {
            return;
          }
          // The current BFF sends {message}, although the watcher declares
          // its warning callback as receiving a string.
          let message = t('logs.streamWarning', {
            defaultValue: 'The log stream reported a warning.',
          });
          if (typeof warning === 'string') {
            message = warning;
          } else if (
            warning !== null &&
            typeof warning === 'object' &&
            'message' in warning &&
            typeof warning.message === 'string'
          ) {
            message = warning.message;
          }
          setStreamWarning(message);
        },
        () => {
          if (active) {
            fallbackToPolling(
              new Error(
                t('logs.disconnected', {
                  defaultValue: 'Live logs disconnected. Using polling',
                }),
              ),
            );
          }
        },
      );
    } catch (error) {
      fallbackToPolling(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return () => {
      active = false;
      stop?.();
    };
  }, [transport, workspace, sandboxName, autoRefresh, retryAttempt, t]);

  const retry = () => {
    setStreamError(null);
    setPollingFailure(null);
    setTransport(Transport.Stream);
    setAutoRefresh(true);
    setRetryAttempt((attempt) => attempt + 1);
  };

  // The watcher currently accepts no filters. Apply the controls to retained
  // lines without reopening the connection on every filter change.
  const logLines = useMemo(() => {
    const sinceMs =
      sinceDurationMs === undefined ? undefined : Date.now() - sinceDurationMs;
    const minimumLevel = LOG_LEVELS.indexOf(level);
    return displayLines
      .filter((line) => {
        const matchesLevel =
          !level ||
          LOG_LEVELS.indexOf(line.level?.toUpperCase() ?? '') >= minimumLevel;
        const matchesSource = !source || (line.source || 'gateway') === source;
        const matchesSince =
          sinceMs === undefined || line.timestampMs >= sinceMs;
        return matchesLevel && matchesSource && matchesSince;
      })
      .slice(-Number(lines));
  }, [displayLines, level, source, sinceDurationMs, lines]);
  const activeError =
    transport === Transport.Poll
      ? (pollingFailure ?? polling.error ?? null)
      : streamError;
  const hasLoadedLogs =
    displayLines.length > 0 ||
    (transport === Transport.Poll && polling.data !== undefined);
  const refreshFailed = activeError !== null && hasLoadedLogs;
  const loadFailed = activeError !== null && !hasLoadedLogs;
  const retryActiveTransport =
    transport === Transport.Poll
      ? () => {
          setPollingFailure(null);
          void polling.refetch();
        }
      : retry;
  const rows = useMemo(
    () => buildLogRows(logLines, { colour: true }),
    [logLines],
  );
  const rowCount = rows.lineOfRow.length;
  const logText =
    rowCount === 0 ? 'No log lines match the current filters.' : rows.text;

  // A different set of lines starts at its newest one again.
  const changeFilter =
    (set: (value: string) => void) => (_event: unknown, value: string) => {
      set(value);
      setAtTail(true);
    };

  const clearFilters = () => {
    setLevel('');
    setSource('');
    setLines('200');
    setSince('');
    setAtTail(true);
  };

  // Scrolling pauses following, not updates from the active transport.
  const isFollowing = autoRefresh && activeError === null && isAtTail;
  let pausedBecause = '';
  if (!autoRefresh) {
    pausedBecause = t('logs.updatesOff', {
      defaultValue: 'Automatic log updates are off.',
    });
  } else if (activeError) {
    pausedBecause = activeError.message;
  } else if (!isAtTail) {
    pausedBecause = 'Scrolled away from the newest line.';
  }

  // Only the user's own scrolling lets go of the newest line or takes hold of
  // it again. A scroll this tab asked for (a refresh, a search) says nothing
  // about where the user wants to be, and neither does a list that has only
  // just been built.
  const onScroll = (scroll: LogViewerScroll) => {
    if (scroll.scrollUpdateWasRequested) {
      return;
    }
    if (isNewList(scroll)) {
      setListGeneration((generation) => generation + 1);
      return;
    }
    setAtTail(scroll.scrollOffsetToBottom <= TAIL_TOLERANCE_PX);
  };

  // While the view is at the newest line it is taken to the end of the list
  // whenever there is a new end: other lines, or a list built anew. Going
  // back to the newest line ("Jump to latest") ends here as well.
  //
  // The viewer's own scrollToRow prop is not used for this. It brings a row
  // into view without allowing for the horizontal scrollbar that lines too
  // long for the window give the list, and leaves the newest line under it.
  const rowsText = rows.text;
  useEffect(() => {
    if (isAtTail) {
      viewerList.current?.scrollToBottom();
    }
  }, [isAtTail, rowsText, listGeneration]);

  const openRow = (row: number) => {
    const index = rows.lineOfRow[row];
    if (index !== undefined) {
      setOpenLine({ lines: logLines, lineOfRow: rows.lineOfRow, index });
    }
  };

  // The number typed for "Line", as the viewer numbers its rows: from one.
  const typedRow = /^\d+$/.test(lineNumber.trim()) ? Number(lineNumber) : 0;
  const typedRowExists = typedRow >= 1 && typedRow <= rowCount;
  const openTypedRow = () => {
    if (typedRowExists) {
      openRow(typedRow - 1);
    }
  };

  const hasFilters =
    level !== '' ||
    source !== '' ||
    lines !== DEFAULT_LOG_LINES ||
    since !== '';
  const toolbar = (
    <Toolbar aria-label="Log filters">
      <ToolbarContent>
        <ToolbarGroup>
          <ToolbarItem>
            <FormSelect
              aria-label="Minimum level"
              value={level}
              onChange={changeFilter(setLevel)}
              data-testid="logs-level-select"
            >
              <FormSelectOption value="" label="All levels" />
              <FormSelectOption value="ERROR" label="Error" />
              <FormSelectOption value="WARN" label="Warn+" />
              <FormSelectOption value="INFO" label="Info+" />
              <FormSelectOption value="DEBUG" label="Debug+" />
              <FormSelectOption value="TRACE" label="Trace+" />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <FormSelect
              aria-label="Log source"
              value={source}
              onChange={changeFilter(setSource)}
              data-testid="logs-source-select"
            >
              <FormSelectOption value="" label="All sources" />
              <FormSelectOption value="gateway" label="Gateway" />
              <FormSelectOption value="sandbox" label="Sandbox" />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <FormSelect
              aria-label="Line count"
              value={lines}
              onChange={changeFilter(setLines)}
              data-testid="logs-lines-select"
            >
              <FormSelectOption value="100" label="100 lines" />
              <FormSelectOption value="200" label="200 lines" />
              <FormSelectOption value="500" label="500 lines" />
              <FormSelectOption value="2000" label="2000 lines" />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <TextInput
              aria-label="Since"
              placeholder="Since, e.g. 5m"
              value={since}
              onChange={changeFilter(setSince)}
              validated={sinceIsInvalid ? 'error' : 'default'}
              data-testid="logs-since-input"
            />
          </ToolbarItem>
          <ToolbarItem alignSelf="center">
            <Checkbox
              id="logs-auto-refresh"
              data-testid="logs-auto-refresh"
              label={t('logs.autoRefresh', { defaultValue: 'Auto-refresh' })}
              isChecked={autoRefresh}
              onChange={(_event, checked) => setAutoRefresh(checked)}
            />
          </ToolbarItem>
          {hasFilters && (
            <ToolbarItem>
              <Button
                variant="link"
                onClick={clearFilters}
                data-testid="logs-clear-filters"
              >
                Clear filters
              </Button>
            </ToolbarItem>
          )}
        </ToolbarGroup>
        <ToolbarGroup align={{ default: 'alignEnd' }}>
          <ToolbarItem>
            {/* A search moves the view to what it found, which is not the
                newest line, so it lets go of that line as scrolling does. */}
            <LogViewerSearch
              placeholder="Search"
              minSearchChars={1}
              onChange={(_event, value) => {
                if (value) {
                  setAtTail(false);
                }
              }}
              onNextClick={() => setAtTail(false)}
              onPreviousClick={() => setAtTail(false)}
            />
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
      {(sinceIsInvalid || sinceDurationMs !== undefined) && (
        <ToolbarContent>
          <ToolbarItem data-testid="logs-since-note">
            <HelperText>
              {sinceIsInvalid ? (
                <HelperTextItem variant="error">
                  Since takes a whole number and a unit: 30s, 5m or 1h. It is
                  not applied.
                </HelperTextItem>
              ) : (
                <HelperTextItem variant="warning">
                  {t('logs.retainedWindow', {
                    defaultValue:
                      'Since filters only retained log lines. Older matching lines may be unavailable.',
                  })}
                </HelperTextItem>
              )}
            </HelperText>
          </ToolbarItem>
        </ToolbarContent>
      )}
    </Toolbar>
  );

  // Under the log: whether the view is following the newest line, the way
  // back to it, and the way to a line's details that needs no mouse. Two
  // groups, so that a narrow window moves the second one to a line of its own
  // without pulling it apart.
  const footer = (
    <Flex
      className="pf-v6-u-mt-sm"
      alignItems={{ default: 'alignItemsCenter' }}
      gap={{ default: 'gapMd' }}
      data-testid="logs-footer"
    >
      <Flex
        alignItems={{ default: 'alignItemsCenter' }}
        gap={{ default: 'gapMd' }}
        flexWrap={{ default: 'nowrap' }}
      >
        <FlexItem>
          <span role="status" data-testid="logs-follow-status">
            <Label isCompact status={isFollowing ? 'success' : 'warning'}>
              {isFollowing ? 'Following' : 'Paused'}
            </Label>
          </span>
        </FlexItem>
        {pausedBecause && (
          <FlexItem>
            <Content component="small" data-testid="logs-paused-reason">
              {pausedBecause}
            </Content>
          </FlexItem>
        )}
        <FlexItem>
          <Button
            variant="link"
            isInline
            icon={<ArrowDownIcon />}
            onClick={() => setAtTail(true)}
            isAriaDisabled={isAtTail}
            data-testid="logs-jump-to-latest"
          >
            Jump to latest
          </Button>
        </FlexItem>
      </Flex>
      <Flex
        align={{ default: 'alignRight' }}
        alignItems={{ default: 'alignItemsCenter' }}
        gap={{ default: 'gapSm' }}
        flexWrap={{ default: 'nowrap' }}
      >
        <FlexItem>
          <Content component="small" id={lineHelpId}>
            Click a line or enter its number to see its details.
          </Content>
        </FlexItem>
        <FlexItem>
          <TextInput
            type="text"
            inputMode="numeric"
            size={12}
            aria-label="Line number"
            aria-describedby={lineHelpId}
            placeholder="Line number"
            value={lineNumber}
            onChange={(_event, value) => setLineNumber(value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openTypedRow();
              }
            }}
            validated={
              lineNumber !== '' && !typedRowExists ? 'error' : 'default'
            }
            data-testid="logs-line-number"
          />
        </FlexItem>
        <FlexItem>
          <Button
            variant="secondary"
            onClick={openTypedRow}
            isDisabled={!typedRowExists}
            data-testid="logs-line-details"
          >
            View line details
          </Button>
        </FlexItem>
      </Flex>
    </Flex>
  );

  const openLineNumber = openLine
    ? openLine.lineOfRow.indexOf(openLine.index) + 1
    : undefined;

  let viewerText = logText;
  if (loadFailed) {
    viewerText = 'The logs could not be loaded.';
  }

  return (
    <>
      {transport === Transport.Poll && (
        <Alert
          variant="info"
          isInline
          title={t('logs.pollingTitle', { defaultValue: 'Using polling' })}
          className="pf-v6-u-mb-md"
          data-testid="logs-polling-fallback"
          actionLinks={
            <Button
              variant="link"
              onClick={retry}
              data-testid="logs-retry-stream"
            >
              {t('logs.retryStream', { defaultValue: 'Retry stream' })}
            </Button>
          }
        >
          {activeError
            ? t('logs.pollingFailed', {
                defaultValue:
                  'Automatic log updates stopped after an error. Press Retry to resume.',
              })
            : autoRefresh
              ? t('logs.pollingDescription', {
                  defaultValue:
                    'Streaming is unavailable. Logs refresh every {{seconds}} seconds until you retry streaming.',
                  seconds: SANDBOX_POLL_MS / 1000,
                })
              : t('logs.pollingPaused', {
                  defaultValue:
                    'Streaming is unavailable. Automatic log updates are off.',
                })}
        </Alert>
      )}
      {loadFailed && (
        <Alert
          variant="danger"
          isInline
          title={t('logs.loadErrorTitle', {
            defaultValue: 'Failed to load logs',
          })}
          className="pf-v6-u-mb-md"
          data-testid="logs-load-error"
          actionLinks={
            <Button variant="link" onClick={retryActiveTransport}>
              {t('actions.retry', { defaultValue: 'Retry' })}
            </Button>
          }
        >
          {activeError?.message}
        </Alert>
      )}
      {refreshFailed && (
        <RefreshErrorAlert
          title={t('logs.refreshErrorTitle', {
            defaultValue: 'The logs could not be refreshed',
          })}
          error={activeError}
          onRetry={retryActiveTransport}
          retryLabel={t('actions.retry', { defaultValue: 'Retry' })}
          className="pf-v6-u-mb-md"
          data-testid="logs-refresh-error"
        />
      )}
      {transport === Transport.Stream && streamWarning && (
        <Alert
          variant="warning"
          isInline
          title={t('logs.warningTitle', { defaultValue: 'Log stream warning' })}
          className="pf-v6-u-mb-md"
          data-testid="logs-stream-warning"
        >
          {streamWarning}
        </Alert>
      )}
      {/* A click on a row opens that line's details. The viewer draws its
          rows itself and they cannot take focus, so the click is caught here
          as it passes; "Line number" under the log does the same from the
          keyboard, which is why this element needs no key handler of its
          own. Selecting text ends in a click as well, and is left alone. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={(event) => {
          if (window.getSelection()?.toString()) {
            return;
          }
          const row = logViewerRowOf(event.target);
          if (row !== undefined) {
            openRow(row);
          }
        }}
        data-testid="logs-rows"
      >
        {isActive && (
          <LogViewer
            data={viewerText}
            theme={theme}
            height={TAB_CONTENT_HEIGHT}
            toolbar={toolbar}
            footer={footer}
            hasLineNumbers
            isTextWrapped={false}
            onScroll={onScroll}
            innerRef={viewerList}
            data-testid="logs-output"
          />
        )}
      </div>
      <LogLineDetailModal
        line={openLine?.lines[openLine.index]}
        lineNumber={openLineNumber}
        lineCount={openLine?.lineOfRow.length}
        onPrevious={
          openLine && openLine.index > 0
            ? () => setOpenLine({ ...openLine, index: openLine.index - 1 })
            : undefined
        }
        onNext={
          openLine && openLine.index < openLine.lines.length - 1
            ? () => setOpenLine({ ...openLine, index: openLine.index + 1 })
            : undefined
        }
        onClose={() => setOpenLine(null)}
      />
    </>
  );
};

export default SandboxLogsTab;
