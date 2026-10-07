import React, { useState } from 'react';
import { Label } from '@patternfly/react-core';
import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { policyStatusColor, policyStatusIcon } from './policyUtils';
import { formatTimestamp } from '../../utils/formatters';
import type { PolicyRevision } from '../../types';

type PolicyRevisionTableProps = {
  revisions: PolicyRevision[];
  showLoaded?: boolean;
  showError?: boolean;
  // The revision in force, marked in its row. Zero or absent marks none.
  activeVersion?: number;
  // What an opened revision shows. Rows expand only when this is given.
  renderDetails?: (revision: PolicyRevision) => React.ReactNode;
  'aria-label'?: string;
  'data-testid'?: string;
};

const PolicyRevisionTable: React.FC<PolicyRevisionTableProps> = ({
  revisions,
  showLoaded = false,
  showError = false,
  activeVersion,
  renderDetails,
  'aria-label': ariaLabel = 'Policy revisions',
  'data-testid': testId = 'policy-revisions-table',
}) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const colSpan =
    3 +
    (showLoaded ? 1 : 0) +
    1 +
    (showError ? 1 : 0) +
    (renderDetails ? 1 : 0);

  const toggle = (version: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });

  const cells = (revision: PolicyRevision) => (
    <>
      <Td dataLabel="Version">
        {revision.version}
        {Boolean(activeVersion) && revision.version === activeVersion && (
          <Label
            isCompact
            color="green"
            className="pf-v6-u-ml-sm"
            data-testid={`${testId}-active`}
          >
            active
          </Label>
        )}
      </Td>
      <Td dataLabel="Status">
        <Label
          isCompact
          color={policyStatusColor(revision.status)}
          icon={policyStatusIcon(revision.status)}
        >
          {revision.status}
        </Label>
      </Td>
      <Td dataLabel="Created">{formatTimestamp(revision.createdAtMs)}</Td>
      {showLoaded && (
        <Td dataLabel="Loaded">{formatTimestamp(revision.loadedAtMs)}</Td>
      )}
      <Td dataLabel="Hash" className="pf-v6-u-font-family-monospace">
        {(revision.policyHash ?? '').slice(0, 12) || '-'}
      </Td>
      {showError && <Td dataLabel="Error">{revision.loadError || '-'}</Td>}
    </>
  );

  return (
    <Table aria-label={ariaLabel} variant="compact" data-testid={testId}>
      <Thead>
        <Tr>
          {renderDetails && <Th screenReaderText="Expand" />}
          <Th>Version</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          {showLoaded && <Th>Loaded</Th>}
          <Th>Hash</Th>
          {showError && <Th>Error</Th>}
        </Tr>
      </Thead>
      {renderDetails ? (
        revisions.map((revision, rowIndex) => {
          const isOpen = expanded.has(revision.version);
          return (
            <Tbody key={revision.version} isExpanded={isOpen}>
              <Tr data-testid={`${testId}-row-${revision.version}`}>
                <Td
                  expand={{
                    rowIndex,
                    isExpanded: isOpen,
                    onToggle: () => toggle(revision.version),
                  }}
                />
                {cells(revision)}
              </Tr>
              <Tr isExpanded={isOpen}>
                <Td dataLabel="Details" colSpan={colSpan}>
                  <ExpandableRowContent>
                    {isOpen && renderDetails(revision)}
                  </ExpandableRowContent>
                </Td>
              </Tr>
            </Tbody>
          );
        })
      ) : (
        <Tbody>
          {revisions.map((revision) => (
            <Tr key={revision.version}>{cells(revision)}</Tr>
          ))}
        </Tbody>
      )}
      {revisions.length === 0 && (
        <Tbody>
          <Tr>
            <Td colSpan={colSpan}>No policy revisions recorded</Td>
          </Tr>
        </Tbody>
      )}
    </Table>
  );
};

export default PolicyRevisionTable;
