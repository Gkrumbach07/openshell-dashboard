import React from 'react';
import { Label } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { policyStatusColor, policyStatusIcon } from './policyUtils';
import { formatTimestamp } from '../../utils/formatters';
import type { PolicyRevision } from '../../types';

type PolicyRevisionTableProps = {
  revisions: PolicyRevision[];
  showLoaded?: boolean;
  showError?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
};

const PolicyRevisionTable: React.FC<PolicyRevisionTableProps> = ({
  revisions,
  showLoaded = false,
  showError = false,
  'aria-label': ariaLabel = 'Policy revisions',
  'data-testid': testId = 'policy-revisions-table',
}) => {
  const colSpan = 3 + (showLoaded ? 1 : 0) + 1 + (showError ? 1 : 0);

  return (
    <Table aria-label={ariaLabel} variant="compact" data-testid={testId}>
      <Thead>
        <Tr>
          <Th>Version</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          {showLoaded && <Th>Loaded</Th>}
          <Th>Hash</Th>
          {showError && <Th>Error</Th>}
        </Tr>
      </Thead>
      <Tbody>
        {revisions.map((revision) => (
          <Tr key={revision.version}>
            <Td dataLabel="Version">{revision.version}</Td>
            <Td dataLabel="Status">
              <Label
                isCompact
                color={policyStatusColor(revision.status)}
                icon={policyStatusIcon(revision.status)}
              >
                {revision.status}
              </Label>
            </Td>
            <Td dataLabel="Created">
              {formatTimestamp(revision.createdAtMs)}
            </Td>
            {showLoaded && (
              <Td dataLabel="Loaded">
                {formatTimestamp(revision.loadedAtMs)}
              </Td>
            )}
            <Td dataLabel="Hash" className="pf-v6-u-font-family-monospace">
              {(revision.policyHash ?? '').slice(0, 12) || '-'}
            </Td>
            {showError && (
              <Td dataLabel="Error">{revision.loadError || '-'}</Td>
            )}
          </Tr>
        ))}
        {revisions.length === 0 && (
          <Tr>
            <Td colSpan={colSpan}>No policy revisions recorded</Td>
          </Tr>
        )}
      </Tbody>
    </Table>
  );
};

export default PolicyRevisionTable;
