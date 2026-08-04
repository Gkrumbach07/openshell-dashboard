import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Label,
} from '@patternfly/react-core';
import { SyncAltIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { formatTimestamp } from '../../utils/formatters';
import type { CredentialRefreshStatus } from '../../types';

type CredentialRefreshCardProps = {
  refreshStatuses: CredentialRefreshStatus[];
  isAdmin: boolean;
  onConfigure: () => void;
  hasCredentials: boolean;
  onRotate: (credentialKey: string) => void;
  isRotating: boolean;
  onDelete: (credentialKey: string) => void;
};

const CredentialRefreshCard: React.FC<CredentialRefreshCardProps> = ({
  refreshStatuses,
  isAdmin,
  onConfigure,
  hasCredentials,
  onRotate,
  isRotating,
  onDelete,
}) => (
  <Card data-testid="provider-refresh-card">
    <CardHeader
      actions={
        isAdmin
          ? {
              actions: (
                <Button
                  variant="secondary"
                  onClick={onConfigure}
                  isDisabled={!hasCredentials}
                  data-testid="configure-refresh-button"
                >
                  Configure refresh
                </Button>
              ),
            }
          : undefined
      }
    >
      <CardTitle>Credential refresh</CardTitle>
    </CardHeader>
    <CardBody>
      {refreshStatuses.length === 0 ? (
        'No credential refresh configured'
      ) : (
        <Table aria-label="Credential refresh status" variant="compact">
          <Thead>
            <Tr>
              <Th>Credential key</Th>
              <Th>Strategy</Th>
              <Th>Status</Th>
              <Th>Expires</Th>
              <Th>Next refresh</Th>
              <Th>Last refresh</Th>
              <Th>Last error</Th>
              {isAdmin && <Th />}
            </Tr>
          </Thead>
          <Tbody>
            {refreshStatuses.map((cred) => (
              <Tr key={cred.credentialKey}>
                <Td dataLabel="Credential key">{cred.credentialKey}</Td>
                <Td dataLabel="Strategy">
                  <Label isCompact color="blue">
                    {cred.strategy}
                  </Label>
                </Td>
                <Td dataLabel="Status">{cred.status}</Td>
                <Td dataLabel="Expires">
                  {cred.expiresAtMs
                    ? formatTimestamp(cred.expiresAtMs)
                    : '-'}
                </Td>
                <Td dataLabel="Next refresh">
                  {cred.nextRefreshAtMs
                    ? formatTimestamp(cred.nextRefreshAtMs)
                    : '-'}
                </Td>
                <Td dataLabel="Last refresh">
                  {cred.lastRefreshAtMs
                    ? formatTimestamp(cred.lastRefreshAtMs)
                    : '-'}
                </Td>
                <Td dataLabel="Last error">{cred.lastError || '-'}</Td>
                {isAdmin && (
                  <Td dataLabel="Actions" isActionCell>
                    <Flex>
                      <FlexItem>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<SyncAltIcon />}
                          isLoading={isRotating}
                          isDisabled={isRotating}
                          onClick={() => onRotate(cred.credentialKey)}
                          data-testid={`rotate-${cred.credentialKey}`}
                        >
                          Rotate now
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<TrashIcon />}
                          onClick={() => onDelete(cred.credentialKey)}
                          data-testid={`delete-refresh-${cred.credentialKey}`}
                        >
                          Delete
                        </Button>
                      </FlexItem>
                    </Flex>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </CardBody>
  </Card>
);

export default CredentialRefreshCard;
