import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { PencilAltIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import {
  useConfigureProviderRefresh,
  useDeleteProviderRefresh,
  useProvider,
  useProviderRefreshStatus,
  useRotateProviderCredential,
} from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import { useWorkspaceRole } from '../api/rbac';
import ConfigureRefreshModal from '../components/provider/ConfigureRefreshModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CredentialRefreshCard from '../components/provider/CredentialRefreshCard';
import ProviderFormModal from '../components/provider/ProviderFormModal';
import LabelsList from '../components/LabelsList';
import { formatTimestamp } from '../utils/formatters';
import type { ConfigureProviderRefreshRequest } from '../types';

type ProviderDetailPageProps = {
  workspace: string;
  providerName: string;
};

// Provider detail. Credential VALUES are secret and never leave the gateway —
// only the credential key names and their expiry timestamps are shown.
const ProviderDetailPage: React.FC<ProviderDetailPageProps> = ({
  workspace,
  providerName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const provider = useProvider(workspace, providerName);
  const refreshStatus = useProviderRefreshStatus(workspace, providerName);
  const configureMutation = useConfigureProviderRefresh(
    workspace,
    providerName,
  );
  const rotateMutation = useRotateProviderCredential(workspace, providerName);
  const deleteMutation = useDeleteProviderRefresh(workspace, providerName);
  const { addSuccess, addDanger } = useAlerts();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isConfigureOpen, setIsConfigureOpen] = useState(false);
  const [deleteRefreshKey, setDeleteRefreshKey] = useState<string | null>(null);

  if (provider.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading provider" />
        </Bullseye>
      </PageSection>
    );
  }

  if (provider.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={`Failed to load provider ${providerName}`}
          actionLinks={
            <Button variant="link" onClick={() => provider.refetch()}>
              Retry
            </Button>
          }
        >
          {(provider.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const data = provider.data;
  if (!data) {
    return null;
  }

  const configEntries = Object.entries(data.config ?? {});
  const expiries = data.credentialExpiresAtMs ?? {};

  return (
    <>
      <PageSection>
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Title headingLevel="h1">{data.metadata.name}</Title>
          </FlexItem>
          {isWorkspaceAdmin && (
            <FlexItem>
              <Button
                variant="secondary"
                icon={<PencilAltIcon />}
                onClick={() => setIsEditOpen(true)}
                data-testid="edit-provider-button"
              >
                Edit provider
              </Button>
            </FlexItem>
          )}
        </Flex>
        <Label color="purple">{data.type}</Label>
      </PageSection>
      <PageSection>
        <Card data-testid="provider-details-card">
          <CardTitle>Details</CardTitle>
          <CardBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>ID</DescriptionListTerm>
                <DescriptionListDescription>
                  {data.metadata.id}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Type (profile)</DescriptionListTerm>
                <DescriptionListDescription>
                  {data.type}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Workspace</DescriptionListTerm>
                <DescriptionListDescription>
                  {data.metadata.workspace || workspace}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Profile scope</DescriptionListTerm>
                <DescriptionListDescription>
                  {data.profileWorkspace || 'platform'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Created</DescriptionListTerm>
                <DescriptionListDescription>
                  {formatTimestamp(data.metadata.createdAtMs)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Labels</DescriptionListTerm>
                <DescriptionListDescription>
                  <LabelsList labels={data.metadata.labels} />
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>
      </PageSection>
      <PageSection>
        <Card data-testid="provider-credentials-card">
          <CardTitle>Credentials</CardTitle>
          <CardBody>
            {(data.credentialNames ?? []).length === 0 ? (
              'No credentials set'
            ) : (
              <Table aria-label="Provider credentials" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Key</Th>
                    <Th>Value</Th>
                    <Th>Expires</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(data.credentialNames ?? []).map((name) => (
                    <Tr key={name}>
                      <Td dataLabel="Key">{name}</Td>
                      <Td dataLabel="Value">
                        <Label isCompact color="grey">
                          secret — write-only
                        </Label>
                      </Td>
                      <Td dataLabel="Expires">
                        {expiries[name]
                          ? formatTimestamp(expiries[name])
                          : 'Never'}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </PageSection>
      <PageSection>
        <CredentialRefreshCard
          refreshStatuses={
            refreshStatus.isError ? [] : (refreshStatus.data ?? [])
          }
          isAdmin={isWorkspaceAdmin}
          onConfigure={() => setIsConfigureOpen(true)}
          hasCredentials={(data.credentialNames ?? []).length > 0}
          onRotate={(credentialKey) =>
            rotateMutation.mutate(credentialKey, {
              onSuccess: () =>
                addSuccess(`Rotated credential "${credentialKey}"`),
              onError: (err) =>
                addDanger(`Rotate failed: ${(err as Error).message}`),
            })
          }
          isRotating={rotateMutation.isPending}
          onDelete={(credentialKey) => setDeleteRefreshKey(credentialKey)}
        />
      </PageSection>
      <PageSection>
        <Card data-testid="provider-config-card">
          <CardTitle>Configuration</CardTitle>
          <CardBody>
            {configEntries.length === 0 ? (
              'No configuration'
            ) : (
              <LabelGroup numLabels={10}>
                {configEntries.map(([key, value]) => (
                  <Label key={key} color="grey">
                    {key}={value}
                  </Label>
                ))}
              </LabelGroup>
            )}
          </CardBody>
        </Card>
      </PageSection>
      <ProviderFormModal
        mode="edit"
        workspace={workspace}
        provider={data}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />
      <ConfigureRefreshModal
        isOpen={isConfigureOpen}
        credentialNames={data.credentialNames ?? []}
        isSubmitting={configureMutation.isPending}
        error={
          configureMutation.isError
            ? (configureMutation.error as Error).message
            : undefined
        }
        onSubmit={(body: ConfigureProviderRefreshRequest) =>
          configureMutation.mutate(body, {
            onSuccess: () => {
              addSuccess(`Configured refresh for "${body.credentialKey}"`);
              setIsConfigureOpen(false);
              configureMutation.reset();
            },
          })
        }
        onClose={() => {
          setIsConfigureOpen(false);
          configureMutation.reset();
        }}
      />
      <ConfirmDeleteModal
        title="Delete credential refresh"
        body={`Remove automatic refresh for credential "${deleteRefreshKey ?? ''}"? The credential value will remain but will no longer be refreshed.`}
        isOpen={deleteRefreshKey !== null}
        isDeleting={deleteMutation.isPending}
        error={
          deleteMutation.isError
            ? (deleteMutation.error as Error).message
            : undefined
        }
        onConfirm={() => {
          if (deleteRefreshKey) {
            deleteMutation.mutate(deleteRefreshKey, {
              onSuccess: () => {
                addSuccess(`Deleted refresh for "${deleteRefreshKey}"`);
                setDeleteRefreshKey(null);
                deleteMutation.reset();
              },
            });
          }
        }}
        onCancel={() => {
          setDeleteRefreshKey(null);
          deleteMutation.reset();
        }}
      />
    </>
  );
};

export default ProviderDetailPage;
