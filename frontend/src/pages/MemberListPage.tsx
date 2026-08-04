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
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { UsersIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { useCurrentUser } from '../api/auth';
import { useMembers, useRemoveMember } from '../api/workspaces';
import { useWorkspaceRole } from '../api/rbac';
import AddMemberModal from '../components/AddMemberModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { formatAge } from '../utils/formatters';

type MemberListPageProps = {
  workspace: string;
};

// Workspace member list. Roles are USER or ADMIN; the API has no
// role-update RPC, so a role change is remove + re-add.
const MemberListPage: React.FC<MemberListPageProps> = ({ workspace }) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const { data: currentUser } = useCurrentUser();
  const members = useMembers(workspace);
  const removeMember = useRemoveMember(workspace);
  const [isAddOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  if (members.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading members" />
      </Bullseye>
    );
  }

  if (members.isError) {
    return (
      <Alert variant="danger" title="Failed to load members">
        {(members.error as Error).message}
      </Alert>
    );
  }

  const rows = members.data ?? [];

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState titleText="No members" icon={UsersIcon} variant="lg">
          <EmptyStateBody>
            Add members by their OIDC subject to grant access to this workspace.
          </EmptyStateBody>
          {isWorkspaceAdmin && (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  onClick={() => setAddOpen(true)}
                  data-testid="add-member-empty"
                >
                  Add member
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          )}
        </EmptyState>
      ) : (
        <>
          {isWorkspaceAdmin && (
            <Toolbar aria-label="Member actions">
              <ToolbarContent>
                <ToolbarItem>
                  <Button
                    onClick={() => setAddOpen(true)}
                    data-testid="add-member"
                  >
                    Add member
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>
          )}
          <Table aria-label="Workspace members" data-testid="member-table">
            <Thead>
              <Tr>
                <Th>Subject</Th>
                <Th>Role</Th>
                <Th>Added</Th>
                {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((member) => {
                const isCurrentUser =
                  member.principalSubject === currentUser?.subject;
                return (
                  <Tr key={member.principalSubject}>
                    <Td dataLabel="Subject">
                      {isCurrentUser && currentUser?.displayName ? (
                        <>
                          {currentUser.displayName}{' '}
                          <Label isCompact color="blue">
                            you
                          </Label>
                        </>
                      ) : (
                        member.principalSubject
                      )}
                    </Td>
                    <Td dataLabel="Role">
                      <Label
                        color={member.role === 'ADMIN' ? 'yellow' : 'blue'}
                      >
                        {member.role}
                      </Label>
                    </Td>
                    <Td dataLabel="Added">
                      {formatAge(member.metadata.createdAtMs)}
                    </Td>
                    {isWorkspaceAdmin && (
                      <Td isActionCell>
                        <ActionsColumn
                          items={[
                            {
                              title: 'Remove',
                              onClick: () =>
                                setRemoveTarget(member.principalSubject),
                            },
                          ]}
                        />
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </>
      )}
      <AddMemberModal
        workspace={workspace}
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
      />
      <ConfirmDeleteModal
        title="Remove member?"
        body={`"${removeTarget ?? ''}" will lose access to this workspace. To change a role instead, remove and re-add with the new role.`}
        variant="remove"
        isOpen={removeTarget !== null}
        isDeleting={removeMember.isPending}
        error={
          removeMember.isError
            ? (removeMember.error as Error).message
            : undefined
        }
        onConfirm={() => {
          if (removeTarget) {
            removeMember.mutate(removeTarget, {
              onSuccess: () => setRemoveTarget(null),
            });
          }
        }}
        onCancel={() => {
          removeMember.reset();
          setRemoveTarget(null);
        }}
      />
    </>
  );
};

export default MemberListPage;
