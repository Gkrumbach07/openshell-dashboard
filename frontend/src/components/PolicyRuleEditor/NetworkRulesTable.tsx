import React from 'react';
import { Alert, Button, Label } from '@patternfly/react-core';
import { TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { endpointSummary } from './utils';
import type { NetworkPolicyRule } from '../../types';

type NetworkRulesTableProps = {
  networkRules: Record<string, NetworkPolicyRule>;
  isEditable: boolean;
  onRemoveRule: (name: string) => void;
  isRemoving: boolean;
};

const NetworkRulesTable: React.FC<NetworkRulesTableProps> = ({
  networkRules,
  isEditable,
  onRemoveRule,
  isRemoving,
}) => {
  if (Object.keys(networkRules).length === 0) {
    return (
      <Alert variant="info" isInline title="No network rules">
        This sandbox has no network egress. Add an endpoint to allow outbound
        connections.
      </Alert>
    );
  }

  return (
    <Table
      aria-label="Network rules"
      variant="compact"
      data-testid="network-rules-table"
    >
      <Thead>
        <Tr>
          <Th>Rule name</Th>
          <Th>Endpoints</Th>
          <Th>Binaries</Th>
          {isEditable && <Th screenReaderText="Actions" />}
        </Tr>
      </Thead>
      <Tbody>
        {Object.entries(networkRules).map(([name, rule]) => (
          <Tr key={name}>
            <Td dataLabel="Rule name">
              <Label isCompact color="blue">
                {name}
              </Label>
            </Td>
            <Td dataLabel="Endpoints">
              {(rule.endpoints ?? []).map((ep, i) => (
                <Label key={i} isCompact color="teal" className="pf-v6-u-mr-xs">
                  {endpointSummary(ep)}
                </Label>
              ))}
              {(rule.endpoints ?? []).length === 0 && '-'}
            </Td>
            <Td dataLabel="Binaries">
              {(rule.binaries ?? []).map((b) => b.path).join(', ') || '-'}
            </Td>
            {isEditable && (
              <Td isActionCell>
                <Button
                  variant="plain"
                  icon={<TrashIcon />}
                  onClick={() => onRemoveRule(name)}
                  isDisabled={isRemoving}
                  aria-label={`Remove rule ${name}`}
                  data-testid={`remove-rule-${name}`}
                />
              </Td>
            )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};

export default NetworkRulesTable;
