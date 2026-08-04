import React from 'react';
import { Card, CardBody, CardTitle } from '@patternfly/react-core';
import { Table, Tbody, Td, Tr } from '@patternfly/react-table';

import type { SandboxPolicy } from '../../types';

type StaticPolicyCardProps = {
  policy: SandboxPolicy | undefined;
};

const StaticPolicyCard: React.FC<StaticPolicyCardProps> = ({ policy }) => (
  <Card>
    <CardTitle>Static policy (immutable after create)</CardTitle>
    <CardBody>
      <Table aria-label="Static policy" variant="compact">
        <Tbody>
          <Tr>
            <Td>Filesystem read-only</Td>
            <Td>{policy?.filesystem?.readOnly?.join(', ') || '-'}</Td>
          </Tr>
          <Tr>
            <Td>Filesystem read-write</Td>
            <Td>{policy?.filesystem?.readWrite?.join(', ') || '-'}</Td>
          </Tr>
          <Tr>
            <Td>Landlock</Td>
            <Td>{policy?.landlock?.compatibility || '-'}</Td>
          </Tr>
          <Tr>
            <Td>Process</Td>
            <Td>
              {policy?.process
                ? `${policy.process.runAsUser || '-'}:${policy.process.runAsGroup || '-'}`
                : '-'}
            </Td>
          </Tr>
        </Tbody>
      </Table>
    </CardBody>
  </Card>
);

export default StaticPolicyCard;
