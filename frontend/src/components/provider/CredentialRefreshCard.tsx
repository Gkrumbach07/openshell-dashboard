import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { SyncAltIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { formatTimestamp } from '../../utils/formatters';
import type { CredentialRefreshStatus } from '../../types';
import RefreshErrorAlert from '../RefreshErrorAlert';

type CredentialRefreshCardProps = {
  // What the gateway last said of the refreshes configured on the provider.
  refreshStatuses: CredentialRefreshStatus[];
  // The error of the last attempt to read that, when it failed. The status
  // is read again while the page is open, and a read that fails says nothing
  // about the refreshes: the statuses read before are still shown, with their
  // actions, and the failure is reported above them.
  statusError?: unknown;
  // Whether refreshStatuses is something the gateway said, now or earlier.
  // False when the status was never read: an empty list is then not "no
  // refresh configured", and the card says it could not be loaded instead.
  isStatusKnown?: boolean;
  onRetryStatus?: () => void;
  isAdmin: boolean;
  onConfigure: () => void;
  hasCredentials: boolean;
  onRotate: (credentialKey: string) => void;
  isRotating: boolean;
  onDelete: (credentialKey: string) => void;
};

type Recovery = {
  label: string;
  // What the gateway's recovery action asks of whoever is reading.
  advice: string;
  variant: 'info' | 'warning' | 'danger';
};

// What each recovery action the gateway reports means, in the gateway's own
// terms: it retries by itself, the grant has to be replaced, the
// configuration has to be repaired, or it does not recognize the failure.
const RECOVERY: Record<string, Recovery> = {
  RETRY: {
    label: 'Retrying',
    advice:
      'The gateway will try again by itself. Nothing is needed unless it keeps failing.',
    variant: 'info',
  },
  REAUTHORIZE: {
    label: 'Reauthorize',
    advice:
      'The grant behind this credential is no longer accepted. Configure refresh again with new material to replace it.',
    variant: 'warning',
  },
  FIX_CONFIGURATION: {
    label: 'Fix configuration',
    advice:
      'The refresh is configured wrongly. Correct its material, or the refresh the provider profile declares, and configure it again.',
    variant: 'warning',
  },
  INVESTIGATE: {
    label: 'Investigate',
    advice:
      'The gateway does not recognize this failure. Look at the failure code and the last error, and at the gateway log.',
    variant: 'danger',
  },
};

// An action this dashboard has no words for is still shown, by its name.
const recoveryFor = (action: string): Recovery =>
  RECOVERY[action] ?? {
    label: action,
    advice: `The gateway reports the recovery action ${action}.`,
    variant: 'warning',
  };

const failureOf = (status: CredentialRefreshStatus): string =>
  [status.failureCode, status.providerErrorSubtype].filter(Boolean).join(' / ');

const CredentialRefreshCard: React.FC<CredentialRefreshCardProps> = ({
  refreshStatuses,
  statusError,
  isStatusKnown = true,
  onRetryStatus,
  isAdmin,
  onConfigure,
  hasCredentials,
  onRotate,
  isRotating,
  onDelete,
}) => {
  const needingRecovery = refreshStatuses.filter(
    (status) => status.recoveryAction,
  );
  const statusFailed = statusError !== undefined && statusError !== null;
  const retry = () => onRetryStatus?.();
  return (
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
        {statusFailed && isStatusKnown && (
          <RefreshErrorAlert
            title="The credential refresh status could not be refreshed"
            staleNote="The status shown was read earlier and may be out of date."
            error={statusError}
            onRetry={retry}
            className="pf-v6-u-mb-md"
            data-testid="refresh-status-stale"
          />
        )}
        {statusFailed && !isStatusKnown ? (
          <Alert
            variant="danger"
            isInline
            component="h3"
            title="The credential refresh status could not be loaded"
            data-testid="refresh-status-error"
            actionLinks={
              <Button variant="link" isInline onClick={retry}>
                Retry
              </Button>
            }
          >
            {(statusError as Error | null)?.message} Whether refresh is
            configured for this provider is not known.
          </Alert>
        ) : !isStatusKnown ? (
          // Being read for the first time: nothing is known yet either way.
          <Spinner size="md" aria-label="Loading credential refresh status" />
        ) : refreshStatuses.length === 0 ? (
          'No credential refresh configured'
        ) : (
          <Stack hasGutter>
            {needingRecovery.map((status) => {
              const recovery = recoveryFor(status.recoveryAction ?? '');
              return (
                <StackItem key={status.credentialKey}>
                  <Alert
                    variant={recovery.variant}
                    isInline
                    component="h3"
                    title={`Refresh of ${status.credentialKey} failed: ${recovery.label.toLowerCase()}`}
                    data-testid={`refresh-recovery-${status.credentialKey}`}
                  >
                    {recovery.advice}
                    {failureOf(status) &&
                      ` Failure code: ${failureOf(status)}.`}
                    {status.lastErrorAtMs
                      ? ` Failed ${formatTimestamp(status.lastErrorAtMs)}.`
                      : ''}
                  </Alert>
                </StackItem>
              );
            })}
            <StackItem>
              <Table aria-label="Credential refresh status" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Credential key</Th>
                    <Th>Strategy</Th>
                    <Th>Status</Th>
                    <Th>Recovery</Th>
                    <Th>Expires</Th>
                    <Th>Next refresh</Th>
                    <Th>Last refresh</Th>
                    <Th>Failure code</Th>
                    <Th>Last error</Th>
                    {isAdmin && <Th screenReaderText="Actions" />}
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
                      <Td dataLabel="Recovery">
                        {cred.recoveryAction ? (
                          <Label
                            isCompact
                            status={recoveryFor(cred.recoveryAction).variant}
                          >
                            {recoveryFor(cred.recoveryAction).label}
                          </Label>
                        ) : (
                          '-'
                        )}
                      </Td>
                      <Td dataLabel="Expires">
                        {cred.expiresAtMs
                          ? formatTimestamp(cred.expiresAtMs)
                          : '-'}
                      </Td>
                      <Td dataLabel="Next refresh">
                        {cred.nextRefreshAtMs
                          ? formatTimestamp(cred.nextRefreshAtMs)
                          : 'Not scheduled'}
                      </Td>
                      <Td dataLabel="Last refresh">
                        {cred.lastRefreshAtMs
                          ? formatTimestamp(cred.lastRefreshAtMs)
                          : '-'}
                      </Td>
                      <Td dataLabel="Failure code">{failureOf(cred) || '-'}</Td>
                      <Td dataLabel="Last error">
                        {cred.lastError || '-'}
                        {cred.lastError && cred.lastErrorAtMs
                          ? ` (${formatTimestamp(cred.lastErrorAtMs)})`
                          : ''}
                      </Td>
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
            </StackItem>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
};

export default CredentialRefreshCard;
