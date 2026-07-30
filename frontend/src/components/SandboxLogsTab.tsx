import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  Label,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';

import { useSandboxLogs } from '../api/sandboxes';
import type { LogLine } from '../types';

type SandboxLogsTabProps = {
  workspace: string;
  sandboxName: string;
};

const levelColor = (level?: string): 'red' | 'orange' | 'blue' | 'grey' => {
  switch ((level ?? '').toUpperCase()) {
    case 'ERROR':
      return 'red';
    case 'WARN':
      return 'orange';
    case 'INFO':
      return 'blue';
    default:
      return 'grey';
  }
};

const LogRow: React.FC<{ line: LogLine }> = ({ line }) => (
  <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsBaseline' }}>
    <FlexItem>
      <span className="pf-v6-u-white-space-nowrap pf-v6-u-color-200">
        {new Date(line.timestampMs).toLocaleTimeString()}
      </span>
    </FlexItem>
    <FlexItem>
      <Label isCompact color={levelColor(line.level)}>
        {(line.level || 'LOG').toUpperCase()}
      </Label>
    </FlexItem>
    {line.source && (
      <FlexItem>
        <Label isCompact color="grey">
          {line.source}
        </Label>
      </FlexItem>
    )}
    <FlexItem grow={{ default: 'grow' }}>
      <span className="pf-v6-u-word-break-break-word">
        {line.message}
        {Object.entries(line.fields ?? {}).map(([key, value]) => (
          <Label key={key} isCompact color="teal" className="pf-v6-u-ml-xs">
            {key}={value}
          </Label>
        ))}
      </span>
    </FlexItem>
  </Flex>
);

const SandboxLogsTab: React.FC<SandboxLogsTabProps> = ({ workspace, sandboxName }) => {
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

  return (
    <>
      <Toolbar aria-label="Log filters">
        <ToolbarContent>
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
        </ToolbarContent>
      </Toolbar>
      {logs.isLoading ? (
        <Bullseye>
          <Spinner aria-label="Loading logs" />
        </Bullseye>
      ) : logs.isError ? (
        <Alert
          variant="danger"
          title="Failed to load logs"
          actionLinks={<Button variant="link" onClick={() => logs.refetch()}>Retry</Button>}
        >
          {(logs.error as Error).message}
        </Alert>
      ) : (
        <div
          data-testid="logs-output"
          className="pf-v6-u-font-family-monospace pf-v6-u-font-size-sm"
          style={{ maxHeight: '32rem', overflowY: 'auto', padding: 'var(--pf-t--global--spacer--sm)' }}
        >
          {(logs.data?.logs ?? []).length === 0 ? (
            <span>No log lines match the current filters.</span>
          ) : (
            (logs.data?.logs ?? []).map((line, index) => <LogRow key={index} line={line} />)
          )}
        </div>
      )}
    </>
  );
};

export default SandboxLogsTab;
