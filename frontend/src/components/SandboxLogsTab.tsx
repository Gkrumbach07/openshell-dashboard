import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormSelect,
  FormSelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { LogViewer, LogViewerSearch } from '@patternfly/react-log-viewer';

import { useSandboxLogs } from '../api/sandboxes';
import type { LogLine } from '../types';

type SandboxLogsTabProps = {
  workspace: string;
  sandboxName: string;
};

const formatLogLine = (line: LogLine): string => {
  const ts = new Date(line.timestampMs).toLocaleTimeString();
  const level = (line.level || 'LOG').toUpperCase();
  const source = line.source ? ` [${line.source}]` : '';
  const fields = Object.entries(line.fields ?? {})
    .map(([k, v]) => ` ${k}=${v}`)
    .join('');
  return `${ts}  ${level}${source}  ${line.message}${fields}`;
};

const SandboxLogsTab: React.FC<SandboxLogsTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [lines, setLines] = useState('200');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logs = useSandboxLogs(
    workspace,
    sandboxName,
    {
      lines: Number(lines),
      level: level || undefined,
      sources: source ? [source] : undefined,
    },
    autoRefresh,
  );

  const logText = useMemo(() => {
    const logLines = logs.data?.logs ?? [];
    if (logLines.length === 0) return 'No log lines match the current filters.';
    return logLines.map(formatLogLine).join('\n');
  }, [logs.data]);

  const toolbar = (
    <Toolbar aria-label="Log filters">
      <ToolbarContent>
        <ToolbarGroup>
          <ToolbarItem>
            <FormSelect
              aria-label="Minimum level"
              value={level}
              onChange={(_event, value) => setLevel(value)}
              data-testid="logs-level-select"
            >
              <FormSelectOption value="" label="All levels" />
              <FormSelectOption value="ERROR" label="Error" />
              <FormSelectOption value="WARN" label="Warn+" />
              <FormSelectOption value="INFO" label="Info+" />
              <FormSelectOption value="DEBUG" label="Debug+" />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <FormSelect
              aria-label="Log source"
              value={source}
              onChange={(_event, value) => setSource(value)}
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
              onChange={(_event, value) => setLines(value)}
              data-testid="logs-lines-select"
            >
              <FormSelectOption value="100" label="100 lines" />
              <FormSelectOption value="200" label="200 lines" />
              <FormSelectOption value="500" label="500 lines" />
              <FormSelectOption value="2000" label="2000 lines" />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem alignSelf="center">
            <Checkbox
              id="logs-auto-refresh"
              data-testid="logs-auto-refresh"
              label="Auto-refresh (5s)"
              isChecked={autoRefresh}
              onChange={(_event, checked) => setAutoRefresh(checked)}
            />
          </ToolbarItem>
          {(level !== '' || source !== '' || lines !== '200') && (
            <ToolbarItem>
              <Button
                variant="link"
                onClick={() => {
                  setLevel('');
                  setSource('');
                  setLines('200');
                }}
                data-testid="logs-clear-filters"
              >
                Clear filters
              </Button>
            </ToolbarItem>
          )}
        </ToolbarGroup>
        <ToolbarGroup align={{ default: 'alignEnd' }}>
          <ToolbarItem>
            <LogViewerSearch placeholder="Search" minSearchChars={1} />
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );

  if (logs.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load logs"
        actionLinks={
          <Button variant="link" onClick={() => logs.refetch()}>
            Retry
          </Button>
        }
      >
        {(logs.error as Error).message}
      </Alert>
    );
  }

  return (
    <LogViewer
      data={logs.isLoading ? 'Loading...' : logText}
      theme="dark"
      height={500}
      toolbar={toolbar}
      hasLineNumbers
      isTextWrapped={false}
      data-testid="logs-output"
    />
  );
};

export default SandboxLogsTab;
