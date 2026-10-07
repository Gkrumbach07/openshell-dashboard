import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  LabelGroup,
  List,
  ListItem,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  ExpandableRowContent,
  type IAction,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import {
  PLATFORM_PROFILE_SCOPE,
  useDeleteProviderProfile,
  useProviderProfiles,
} from '../../api/providers';
import { useAlerts } from '../../app/AlertContext';
import type {
  ProfileCredential,
  ProfileNetworkEndpoint,
  ProviderProfile,
} from '../../types';
import { downloadText } from '../../utils/download';
import {
  isProfileExportable,
  type ProfileFileFormat,
  serializeProfileFile,
} from '../../utils/profileFile';
import {
  isAmbiguousProfile,
  isOwnProfile,
  profileKey,
} from '../../utils/providerProfiles';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import CreateProfileModal from '../CreateProfileModal';
import RefreshErrorAlert, { isRefreshError } from '../RefreshErrorAlert';
import ProfileFileModal from './ProfileFileModal';

type ProfilesPanelProps = {
  // The workspace whose profiles are shown, or PLATFORM_PROFILE_SCOPE.
  scope: string;
  // Whether the viewer may change this scope's profiles: a workspace admin
  // for a workspace, a platform admin for the platform. It decides what is
  // offered; the gateway decides what is allowed.
  canManage: boolean;
};

const SCOPE_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  platform: 'Platform',
};

const FILE_TYPES: Record<ProfileFileFormat, string> = {
  yaml: 'application/yaml',
  json: 'application/json',
};

// How a credential gets its value, when it is not simply given one.
const credentialSource = (
  credential: ProfileCredential,
): string | undefined => {
  if (credential.tokenGrant) {
    return 'token grant';
  }
  return credential.refresh
    ? `refresh: ${credential.refresh.strategy.toLowerCase()}`
    : undefined;
};

// The last word of an enum name, in lower case: READ_ONLY of
// NETWORK_ACCESS_PRESET_READ_ONLY reads "read only".
const modeName = (value: string | number | undefined, prefix: string) =>
  typeof value === 'string' && value.startsWith(prefix)
    ? value.slice(prefix.length).toLowerCase().replace(/_/g, ' ')
    : undefined;

// What an endpoint allows, as far as one line can say it.
const endpointTraits = (endpoint: ProfileNetworkEndpoint): string[] =>
  [
    endpoint.protocol,
    endpoint.path,
    modeName(endpoint.access, 'NETWORK_ACCESS_PRESET_'),
    endpoint.rules?.length ? `${endpoint.rules.length} allow rules` : undefined,
    endpoint.denyRules?.length
      ? `${endpoint.denyRules.length} deny rules`
      : undefined,
    modeName(endpoint.enforcement, 'NETWORK_ENFORCEMENT_MODE_'),
    endpoint.tls === 'NETWORK_TLS_MODE_SKIP' ? 'no TLS inspection' : undefined,
  ].filter((trait): trait is string => !!trait);

const endpointAddress = (endpoint: ProfileNetworkEndpoint): string => {
  const ports = endpoint.port ? [endpoint.port] : (endpoint.ports ?? []);
  return ports.length > 0
    ? `${endpoint.host ?? ''}:${ports.join(',')}`
    : (endpoint.host ?? '');
};

const ProfileDetails: React.FC<{ profile: ProviderProfile }> = ({
  profile,
}) => {
  const annotations = Object.entries(profile.annotations ?? {});
  return (
    <>
      {profile.description && (
        <Content component="p">{profile.description}</Content>
      )}
      <DescriptionList isCompact isHorizontal>
        <DescriptionListGroup>
          <DescriptionListTerm>Credentials</DescriptionListTerm>
          <DescriptionListDescription>
            {profile.credentials.length === 0 ? (
              'none'
            ) : (
              <List isPlain>
                {profile.credentials.map((credential) => (
                  <ListItem key={credential.name}>
                    {credential.name}
                    {credential.required ? ' (required)' : ''}
                    {credential.envVars?.length
                      ? `, as ${credential.envVars.join(', ')}`
                      : ''}{' '}
                    {credentialSource(credential) && (
                      <Label isCompact color="blue">
                        {credentialSource(credential)}
                      </Label>
                    )}
                  </ListItem>
                ))}
              </List>
            )}
          </DescriptionListDescription>
        </DescriptionListGroup>
        {profile.networkEndpoints !== undefined
          ? profile.networkEndpoints.length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Endpoints</DescriptionListTerm>
                <DescriptionListDescription>
                  <List isPlain>
                    {profile.networkEndpoints.map((endpoint, index) => (
                      <ListItem key={index}>
                        <Label isCompact color="teal">
                          {endpointAddress(endpoint)}
                        </Label>{' '}
                        {endpointTraits(endpoint).join(', ')}
                      </ListItem>
                    ))}
                  </List>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )
          : (profile.endpoints ?? []).length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Endpoints</DescriptionListTerm>
                <DescriptionListDescription>
                  <LabelGroup numLabels={6}>
                    {(profile.endpoints ?? []).map((endpoint, index) => (
                      <Label key={index} isCompact color="teal">
                        {endpoint}
                      </Label>
                    ))}
                  </LabelGroup>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
        {(profile.binaries ?? []).length > 0 && (
          <DescriptionListGroup>
            <DescriptionListTerm>Binaries</DescriptionListTerm>
            <DescriptionListDescription>
              <LabelGroup numLabels={8}>
                {(profile.binaries ?? []).map((binary) => (
                  <Label key={binary.path} isCompact color="grey">
                    {binary.path}
                  </Label>
                ))}
              </LabelGroup>
            </DescriptionListDescription>
          </DescriptionListGroup>
        )}
        {annotations.length > 0 && (
          <DescriptionListGroup>
            <DescriptionListTerm>Annotations</DescriptionListTerm>
            <DescriptionListDescription>
              <LabelGroup numLabels={8}>
                {annotations.map(([key, value]) => (
                  <Label key={key} isCompact color="grey">
                    {key}={value}
                  </Label>
                ))}
              </LabelGroup>
            </DescriptionListDescription>
          </DescriptionListGroup>
        )}
      </DescriptionList>
    </>
  );
};

// The provider profiles of one scope: a workspace's, with the platform's
// among them, or the platform's own. Profiles are listed with the scope that
// owns each, exported as profile files, and, by someone who may manage the
// scope, imported from files, created, updated from a file and deleted.
//
// A profile can only be changed in the scope that owns it. A workspace lists
// the platform's profiles and cannot update or delete them, and nobody can
// change one an interceptor vends; those actions are offered where the
// gateway accepts them.
const ProfilesPanel: React.FC<ProfilesPanelProps> = ({ scope, canManage }) => {
  const isPlatform = scope === PLATFORM_PROFILE_SCOPE;
  const ownScope = isPlatform ? 'platform' : 'workspace';
  const profiles = useProviderProfiles(scope);
  const deleteProfile = useDeleteProviderProfile(scope);
  const { addSuccess } = useAlerts();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isImportOpen, setImportOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<ProviderProfile | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (profiles.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading provider profiles" />
      </Bullseye>
    );
  }

  // The list is polled. A refresh that fails leaves the profiles that loaded
  // before on screen, with a note above them, and leaves a dialog that is
  // open over them (a profile being created, files chosen for an import) as
  // it was; only a list that never loaded takes the panel.
  const refreshFailed = isRefreshError(profiles);
  if (profiles.isError && !refreshFailed) {
    return (
      <Alert
        variant="danger"
        title="Failed to load provider profiles"
        actionLinks={
          <Button variant="link" onClick={() => profiles.refetch()}>
            Retry
          </Button>
        }
      >
        {(profiles.error as Error).message}
      </Alert>
    );
  }

  const rows = profiles.data ?? [];

  const toggle = (key: string) => {
    setExpanded((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  // The file is named for the profile. An id that is listed in more than one
  // scope (the workspace's own profile and the platform profile it shadows)
  // would give two files of one name, so the name then says which scope the
  // profile is from. The name still ends in the format, which is what the
  // dashboard and the CLI read a profile file by.
  const exportProfile = (
    profile: ProviderProfile,
    format: ProfileFileFormat,
  ) => {
    const scoped = profile.scope && isAmbiguousProfile(rows, profile);
    downloadText(
      `${profile.id}${scoped ? `.${profile.scope}` : ''}.${format}`,
      serializeProfileFile(profile, format),
      FILE_TYPES[format],
    );
  };

  const actionsFor = (profile: ProviderProfile): IAction[] => {
    const exportable = isProfileExportable(profile);
    const exports: IAction[] = (['yaml', 'json'] as const).map((format) => ({
      title: `Export as ${format.toUpperCase()}`,
      isAriaDisabled: !exportable,
      description: exportable
        ? undefined
        : 'This backend cannot read what the endpoints allow, so the file would lose it',
      onClick: () => exportProfile(profile, format),
    }));
    if (!canManage || !isOwnProfile(profile, ownScope)) {
      return exports;
    }
    return [
      ...exports,
      { isSeparator: true },
      {
        title: 'Update from file',
        onClick: () => setUpdateTarget(profile),
      },
      {
        title: 'Delete',
        onClick: () => setDeleteTarget(profile.id),
      },
    ];
  };

  const modals = (
    <>
      <CreateProfileModal
        workspace={scope}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => addSuccess('Profile created')}
      />
      <ProfileFileModal
        scope={scope}
        isOpen={isImportOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={addSuccess}
      />
      <ProfileFileModal
        scope={scope}
        target={updateTarget ?? undefined}
        isOpen={updateTarget !== null}
        onClose={() => setUpdateTarget(null)}
        onSuccess={addSuccess}
      />
    </>
  );

  const manageButtons = canManage && (
    <>
      <ToolbarItem>
        <Button
          onClick={() => setCreateOpen(true)}
          data-testid="create-profile"
        >
          Create profile
        </Button>
      </ToolbarItem>
      <ToolbarItem>
        <Button
          variant="secondary"
          onClick={() => setImportOpen(true)}
          data-testid="import-profiles"
        >
          Import from files
        </Button>
      </ToolbarItem>
    </>
  );

  // One return for the empty list and the table. The dialogs sit after
  // whichever of the two is shown, at the same place among their siblings, so
  // React keeps them, and what was typed or chosen in them, when a poll takes
  // the list from empty to not empty or back.
  return (
    <>
      {refreshFailed && (
        <RefreshErrorAlert
          title="The provider profiles could not be refreshed"
          staleNote="The profiles shown were loaded earlier and may be out of date."
          error={profiles.error}
          onRetry={() => profiles.refetch()}
          className="pf-v6-u-mb-md"
          data-testid="profiles-refresh-error"
        />
      )}
      {rows.length === 0 ? (
        <EmptyState
          variant="lg"
          titleText="No provider profiles"
          icon={PlusCircleIcon}
        >
          <EmptyStateBody>
            Provider profiles define the credential schema and network endpoints
            for a provider type. A gateway serves the profiles that were
            imported into it: import profile files, such as the examples
            OpenShell publishes, or create a profile here.
          </EmptyStateBody>
          {canManage && (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  onClick={() => setImportOpen(true)}
                  data-testid="import-profiles-empty"
                >
                  Import from files
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setCreateOpen(true)}
                  data-testid="create-profile-empty"
                >
                  Create profile
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          )}
        </EmptyState>
      ) : (
        <>
          {canManage && (
            <Toolbar aria-label="Profile actions">
              <ToolbarContent>{manageButtons}</ToolbarContent>
            </Toolbar>
          )}
          <Table aria-label="Provider profiles" data-testid="profiles-table">
            <Thead>
              <Tr>
                <Th screenReaderText="Expand" />
                <Th>Profile</Th>
                <Th>Category</Th>
                <Th>Scope</Th>
                <Th>Source</Th>
                <Th>Inference</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            {rows.map((profile, rowIndex) => {
              const key = profileKey(profile);
              const isExpanded = expanded.includes(key);
              return (
                <Tbody key={key} isExpanded={isExpanded}>
                  <Tr data-testid={`profile-row-${key}`}>
                    <Td
                      expand={{
                        rowIndex,
                        isExpanded,
                        onToggle: () => toggle(key),
                      }}
                    />
                    <Td dataLabel="Profile">
                      <strong>{profile.displayName}</strong>{' '}
                      <Label isCompact color="grey">
                        {profile.id}
                      </Label>
                    </Td>
                    <Td dataLabel="Category">
                      <Label isCompact color="purple">
                        {profile.category}
                      </Label>
                    </Td>
                    <Td dataLabel="Scope">
                      {profile.scope ? (
                        <Label
                          isCompact
                          color={
                            profile.scope === 'platform' ? 'orange' : 'blue'
                          }
                        >
                          {SCOPE_LABELS[profile.scope] ?? profile.scope}
                        </Label>
                      ) : (
                        '-'
                      )}
                    </Td>
                    <Td dataLabel="Source">{profile.source || 'builtin'}</Td>
                    <Td dataLabel="Inference">
                      {profile.inferenceCapable ? 'Yes' : '-'}
                    </Td>
                    <Td isActionCell>
                      <ActionsColumn items={actionsFor(profile)} />
                    </Td>
                  </Tr>
                  <Tr isExpanded={isExpanded}>
                    <Td />
                    <Td colSpan={6}>
                      <ExpandableRowContent>
                        <ProfileDetails profile={profile} />
                      </ExpandableRowContent>
                    </Td>
                  </Tr>
                </Tbody>
              );
            })}
          </Table>
        </>
      )}
      {modals}
      <ConfirmDeleteModal
        title="Delete provider profile?"
        body={
          isPlatform
            ? `Profile "${deleteTarget ?? ''}" will be deleted from the platform scope, and no workspace will see it any more. The gateway refuses while a provider still uses it.`
            : `Profile "${deleteTarget ?? ''}" will be deleted. The gateway refuses while a provider still uses it.`
        }
        isOpen={deleteTarget !== null}
        isDeleting={deleteProfile.isPending}
        error={
          deleteProfile.isError
            ? (deleteProfile.error as Error).message
            : undefined
        }
        onConfirm={() => {
          if (deleteTarget) {
            deleteProfile.mutate(deleteTarget, {
              onSuccess: () => {
                addSuccess(`Profile "${deleteTarget}" deleted`);
                setDeleteTarget(null);
                deleteProfile.reset();
              },
            });
          }
        }}
        onCancel={() => {
          setDeleteTarget(null);
          deleteProfile.reset();
        }}
      />
    </>
  );
};

export default ProfilesPanel;
