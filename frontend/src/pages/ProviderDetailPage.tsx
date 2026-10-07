import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  Content,
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
  Stack,
  StackItem,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { PencilAltIcon } from '@patternfly/react-icons';

import {
  useConfigureProviderRefresh,
  useDeleteProviderRefresh,
  useProvider,
  useProviderProfiles,
  useProviderRefreshStatus,
  useRotateProviderCredential,
} from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import { useWorkspaceRole } from '../api/rbac';
import ConfigureRefreshModal from '../components/provider/ConfigureRefreshModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CredentialRefreshCard from '../components/provider/CredentialRefreshCard';
import ProviderCredentialsCard from '../components/provider/ProviderCredentialsCard';
import ProviderDiscoveryCard from '../components/provider/ProviderDiscoveryCard';
import ProviderFormModal from '../components/provider/ProviderFormModal';
import ProviderPolicyCard from '../components/provider/ProviderPolicyCard';
import ProviderProfileRefreshCard from '../components/provider/ProviderProfileRefreshCard';
import LabelsList from '../components/LabelsList';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import { formatTimestamp } from '../utils/formatters';
import {
  isProfileExportable,
  serializeProfileFile,
} from '../utils/profileFile';
import {
  profileForProvider,
  refreshCredentialKeys,
  refreshManagedKeys,
} from '../utils/providerProfiles';
import { profileLabel, providerCategoryLabel } from '../utils/providerSummary';
import { providerToRedactedYaml } from '../utils/providerYaml';
import type { ConfigureProviderRefreshRequest } from '../types';

type ProviderDetailPageProps = {
  workspace: string;
  providerName: string;
};

// Provider detail: the provider, what the profile its type resolves to says
// about it, and both as YAML, which are the summary, "Object YAML" and
// "Profile YAML" views of the OpenShell TUI's provider detail. Credential
// VALUES are secret and never leave the gateway — only the credential key
// names and their expiry timestamps are shown.
const ProviderDetailPage: React.FC<ProviderDetailPageProps> = ({
  workspace,
  providerName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const provider = useProvider(workspace, providerName);
  const profiles = useProviderProfiles(workspace);
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
  const [activeTab, setActiveTab] = useState<string | number>('details');

  // Whether the provider has a profile is not known until the profiles are.
  if (provider.isLoading || profiles.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading provider" />
        </Bullseye>
      </PageSection>
    );
  }

  // The provider is re-read while the page is open. Only a first load that
  // failed takes the page: the dialogs below (edit, configure refresh) live in
  // this component, and a refresh that did not get through must not throw
  // them away with what was typed in them. It is reported above the details
  // instead.
  const refreshFailed = isRefreshError(provider);
  if (provider.isError && !refreshFailed) {
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
  // The profile the provider's type resolves to says which credentials it
  // takes, held or not: refresh is configured per credential, and a provider
  // created with runtime credentials holds none until refresh mints them.
  const profile = profileForProvider(profiles.data ?? [], data);
  const refreshKeys = refreshCredentialKeys(
    profile,
    data.credentialNames ?? [],
  );
  // The credentials a refresh the gateway performs manages, which a provider
  // update may not write. Known only once the refresh status has been read;
  // what was read last still stands when reading it again fails.
  const managedKeys = refreshStatus.data
    ? refreshManagedKeys(profile, refreshStatus.data)
    : undefined;
  // A provider is unprofiled when the profiles were read and none matches its
  // type. When they could not be read, nothing is known about its profile;
  // profiles read earlier still stand when reading them again fails.
  const profilesUnavailable = profiles.isError && profiles.data === undefined;
  const isUnprofiled = !profile && !profilesUnavailable;
  // The workspace lists a profile of this id and the gateway still resolves
  // none: the provider names no profile scope, which is the platform's, and
  // the profile was imported into the workspace (see profileForProvider).
  const hasProfileInOtherScope =
    isUnprofiled &&
    (profiles.data ?? []).some((candidate) => candidate.id === data.type);
  // Why there is no profile YAML to show, when there is none.
  const profileYamlUnavailable = profilesUnavailable
    ? 'Provider profiles could not be loaded.'
    : profile
      ? 'This backend cannot read what the profile endpoints allow, so the profile cannot be shown whole.'
      : 'No provider profile is available for this provider.';

  return (
    <>
      <PageSection>
        {refreshFailed && (
          <RefreshErrorAlert
            title={`Provider ${providerName} could not be refreshed`}
            error={provider.error}
            onRetry={() => provider.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="provider-refresh-error"
          />
        )}
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
        <Tabs
          activeKey={activeTab}
          onSelect={(_event, key) => setActiveTab(key)}
          aria-label="Provider detail"
          mountOnEnter
          unmountOnExit
        >
          <Tab
            eventKey="details"
            title={<TabTitleText>Details</TabTitleText>}
            data-testid="tab-provider-details"
          >
            <Stack hasGutter className="pf-v6-u-pt-lg">
              {profilesUnavailable && (
                <StackItem>
                  <Alert
                    variant="warning"
                    isInline
                    title="Provider profiles could not be loaded"
                    data-testid="provider-profiles-unavailable"
                    actionLinks={
                      <Button variant="link" onClick={() => profiles.refetch()}>
                        Retry
                      </Button>
                    }
                  >
                    What this provider&apos;s profile says about it is not
                    shown: {(profiles.error as Error).message}
                  </Alert>
                </StackItem>
              )}
              {isUnprofiled && (
                <StackItem>
                  <Alert
                    variant="warning"
                    isInline
                    title="Legacy/unprofiled provider"
                    data-testid="provider-unprofiled-alert"
                  >
                    No provider profile matches the type &quot;{data.type}&quot;
                    in the scope this provider names. Nothing says which
                    credentials it takes or what it lets a sandbox reach, so
                    only what the provider itself holds is shown.
                    {hasProfileInOtherScope &&
                      ' This workspace has a profile with that ID, but the provider names no profile scope, and the gateway then looks at platform profiles only. The scope of a provider cannot be changed: create a provider from the workspace profile, or import the profile at platform scope.'}
                  </Alert>
                </StackItem>
              )}
              <StackItem>
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
                        <DescriptionListTerm>
                          Type (profile)
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.type}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      {!profilesUnavailable && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>Profile</DescriptionListTerm>
                          <DescriptionListDescription data-testid="provider-profile-name">
                            {profile ? (
                              profileLabel(profile)
                            ) : (
                              <Label isCompact status="warning">
                                none (legacy/unprofiled provider)
                              </Label>
                            )}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      {!profilesUnavailable && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>Category</DescriptionListTerm>
                          <DescriptionListDescription data-testid="provider-profile-category">
                            {providerCategoryLabel(profile)}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      {profile?.description && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>Description</DescriptionListTerm>
                          <DescriptionListDescription data-testid="provider-profile-description">
                            {profile.description}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
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
                        <DescriptionListTerm>
                          Resource version
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.metadata.resourceVersion}
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
              </StackItem>
              <StackItem>
                <ProviderCredentialsCard provider={data} profile={profile} />
              </StackItem>
              <StackItem>
                <CredentialRefreshCard
                  refreshStatuses={refreshStatus.data ?? []}
                  statusError={
                    refreshStatus.isError ? refreshStatus.error : undefined
                  }
                  isStatusKnown={refreshStatus.data !== undefined}
                  onRetryStatus={() => refreshStatus.refetch()}
                  isAdmin={isWorkspaceAdmin}
                  onConfigure={() => setIsConfigureOpen(true)}
                  hasCredentials={refreshKeys.length > 0}
                  onRotate={(credentialKey) =>
                    rotateMutation.mutate(credentialKey, {
                      onSuccess: () =>
                        addSuccess(`Rotated credential "${credentialKey}"`),
                      onError: (err) =>
                        addDanger(`Rotate failed: ${(err as Error).message}`),
                    })
                  }
                  isRotating={rotateMutation.isPending}
                  onDelete={(credentialKey) =>
                    setDeleteRefreshKey(credentialKey)
                  }
                />
              </StackItem>
              {!profilesUnavailable && (
                <StackItem>
                  <ProviderProfileRefreshCard profile={profile} />
                </StackItem>
              )}
              <StackItem>
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
              </StackItem>
              {!profilesUnavailable && (
                <StackItem>
                  <ProviderPolicyCard profile={profile} />
                </StackItem>
              )}
              {!profilesUnavailable && (
                <StackItem>
                  <ProviderDiscoveryCard profile={profile} />
                </StackItem>
              )}
            </Stack>
          </Tab>
          <Tab
            eventKey="object-yaml"
            title={<TabTitleText>Object YAML</TabTitleText>}
            data-testid="tab-provider-object-yaml"
          >
            <Stack hasGutter className="pf-v6-u-pt-lg">
              <StackItem>
                <Content component="p">
                  The provider as the gateway holds it, read-only. No credential
                  value is shown: each key the provider holds reads
                  &lt;redacted&gt;.
                </Content>
              </StackItem>
              <StackItem>
                <CodeBlock>
                  <CodeBlockCode data-testid="provider-object-yaml">
                    {providerToRedactedYaml(data)}
                  </CodeBlockCode>
                </CodeBlock>
              </StackItem>
            </Stack>
          </Tab>
          <Tab
            eventKey="profile-yaml"
            title={<TabTitleText>Profile YAML</TabTitleText>}
            data-testid="tab-provider-profile-yaml"
          >
            <Stack hasGutter className="pf-v6-u-pt-lg">
              {profile && isProfileExportable(profile) ? (
                <>
                  <StackItem>
                    <Content component="p">
                      The profile this provider&apos;s type resolves to,
                      read-only, as openshell provider profile export writes it.
                    </Content>
                  </StackItem>
                  <StackItem>
                    <CodeBlock>
                      <CodeBlockCode data-testid="provider-profile-yaml">
                        {serializeProfileFile(profile, 'yaml')}
                      </CodeBlockCode>
                    </CodeBlock>
                  </StackItem>
                </>
              ) : (
                <StackItem data-testid="provider-profile-yaml-unavailable">
                  {profileYamlUnavailable}
                </StackItem>
              )}
            </Stack>
          </Tab>
        </Tabs>
      </PageSection>
      <ProviderFormModal
        mode="edit"
        workspace={workspace}
        provider={data}
        refreshManagedKeys={managedKeys}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />
      <ConfigureRefreshModal
        isOpen={isConfigureOpen}
        credentialNames={refreshKeys}
        profile={profile}
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
