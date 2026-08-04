import React, { useState } from 'react';
import {
  Alert,
  Bullseye,
  Content,
  ExpandableSection,
  Label,
  Spinner,
  Timestamp,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useDraftHistory } from '../../api/policy';
import { eventColor } from './utils';

type DraftHistorySectionProps = {
  workspace: string;
  sandboxName: string;
};

const DraftHistorySection: React.FC<DraftHistorySectionProps> = ({
  workspace,
  sandboxName,
}) => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useDraftHistory(workspace, sandboxName);

  return (
    <ExpandableSection
      toggleText={historyOpen ? 'Hide history' : 'Show history'}
      onToggle={(_event, expanded) => setHistoryOpen(expanded)}
      isExpanded={historyOpen}
      data-testid="draft-history-toggle"
    >
      {history.isLoading && (
        <Bullseye>
          <Spinner size="md" aria-label="Loading history" />
        </Bullseye>
      )}
      {history.isError && (
        <Alert variant="danger" isInline title="Failed to load history">
          {(history.error as Error).message}
        </Alert>
      )}
      {history.data && history.data.length === 0 && (
        <Content component="p">No draft history entries yet.</Content>
      )}
      {history.data && history.data.length > 0 && (
        <Table
          aria-label="Draft history"
          variant="compact"
          data-testid="draft-history-list"
        >
          <Thead>
            <Tr>
              <Th>Event</Th>
              <Th>Description</Th>
              <Th>Time</Th>
            </Tr>
          </Thead>
          <Tbody>
            {history.data.map((entry, idx) => (
              <Tr key={idx}>
                <Td dataLabel="Event">
                  <Label isCompact color={eventColor(entry.eventType)}>
                    {entry.eventType}
                  </Label>
                </Td>
                <Td dataLabel="Description">{entry.description}</Td>
                <Td dataLabel="Time">
                  <Timestamp date={new Date(entry.timestampMs)} />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </ExpandableSection>
  );
};

export default DraftHistorySection;
