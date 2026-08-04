import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  LabelGroup,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import {
  useDeleteProviderProfile,
  useProviderProfiles,
} from '../../api/providers';
import { useAlerts } from '../../app/AlertContext';
import { useWorkspaceRole } from '../../api/rbac';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import CreateProfileModal from '../CreateProfileModal';

type ProfilesTabProps = {
  workspace: string;
};

const ProfilesTab: React.FC<ProfilesTabProps> = ({ workspace }) => {
  const profiles = useProviderProfiles(workspace);
  const deleteProfile = useDeleteProviderProfile(workspace);
  const { addSuccess } = useAlerts();
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (profiles.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading provider profiles" />
      </Bullseye>
    );
  }

  if (profiles.isError) {
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

  const toggle = (id: string) => {
    setExpanded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const isCustomProfile = (source?: string) =>
    source === 'user' || (source?.startsWith('interceptor/') ?? false);

  if (rows.length === 0) {
    return (
      <>
        <EmptyState
          variant="lg"
          titleText="No provider profiles"
          icon={PlusCircleIcon}
        >
          <EmptyStateBody>
            Provider profiles define the credential schema and network endpoints
            for a provider type. Built-in profiles are shipped with the gateway.
          </EmptyStateBody>
          {isWorkspaceAdmin && (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  onClick={() => setCreateOpen(true)}
                  data-testid="create-profile-empty"
                >
                  Create profile
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          )}
        </EmptyState>
        <CreateProfileModal
          workspace={workspace}
          isOpen={isCreateOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => addSuccess('Profile created')}
        />
      </>
    );
  }

  return (
    <>
      {isWorkspaceAdmin && (
        <Toolbar aria-label="Profile actions">
          <ToolbarContent>
            <ToolbarItem>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-profile"
              >
                Create profile
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      )}
      <Table aria-label="Provider profiles" data-testid="profiles-table">
        <Thead>
          <Tr>
            <Th screenReaderText="Expand" />
            <Th>Profile</Th>
            <Th>Category</Th>
            <Th>Source</Th>
            <Th>Inference</Th>
            {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
          </Tr>
        </Thead>
        {rows.map((profile, rowIndex) => (
          <Tbody key={profile.id} isExpanded={expanded.includes(profile.id)}>
            <Tr>
              <Td
                expand={{
                  rowIndex,
                  isExpanded: expanded.includes(profile.id),
                  onToggle: () => toggle(profile.id),
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
              <Td dataLabel="Source">{profile.source || 'builtin'}</Td>
              <Td dataLabel="Inference">
                {profile.inferenceCapable ? 'Yes' : '-'}
              </Td>
              {isWorkspaceAdmin && (
                <Td isActionCell>
                  {isCustomProfile(profile.source) && (
                    <ActionsColumn
                      items={[
                        {
                          title: 'Delete',
                          onClick: () => setDeleteTarget(profile.id),
                        },
                      ]}
                    />
                  )}
                </Td>
              )}
            </Tr>
            <Tr isExpanded={expanded.includes(profile.id)}>
              <Td />
              <Td colSpan={isWorkspaceAdmin ? 5 : 4}>
                <ExpandableRowContent>
                  {profile.description && <div>{profile.description}</div>}
                  <div className="pf-v6-u-mt-sm">
                    <strong>Credentials:</strong>{' '}
                    {profile.credentials.length === 0
                      ? 'none'
                      : profile.credentials
                          .map(
                            (credential) =>
                              `${credential.name}${credential.required ? ' (required)' : ''}`,
                          )
                          .join(', ')}
                  </div>
                  {(profile.endpoints ?? []).length > 0 && (
                    <div className="pf-v6-u-mt-sm">
                      <strong>Endpoints:</strong>{' '}
                      <LabelGroup numLabels={6}>
                        {(profile.endpoints ?? []).map((endpoint) => (
                          <Label key={endpoint} isCompact color="teal">
                            {endpoint}
                          </Label>
                        ))}
                      </LabelGroup>
                    </div>
                  )}
                </ExpandableRowContent>
              </Td>
            </Tr>
          </Tbody>
        ))}
      </Table>
      <CreateProfileModal
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => addSuccess('Profile created')}
      />
      <ConfirmDeleteModal
        title="Delete provider profile?"
        body={`Profile "${deleteTarget ?? ''}" will be deleted. Existing providers using this type will keep working but new providers of this type cannot be created.`}
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

export default ProfilesTab;
