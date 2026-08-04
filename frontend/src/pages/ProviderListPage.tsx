import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  LabelGroup,
  MenuToggle,
  Pagination,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import { EllipsisVIcon, PlusCircleIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { deleteProvider, useProviders } from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import { useWorkspaceRole } from '../app/useWorkspaceRole';
import { useSlots } from '../slots';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CreateProviderModal from '../components/CreateProviderModal';
import { useBulkDelete } from '../components/useBulkDelete';
import { formatAge } from '../components/utils';
import type { CredentialInputSlot } from '../types';

type ProviderListPageProps = {
  workspace: string;
  onSelect?: (name: string) => void;
  renderCredentialInput?: CredentialInputSlot;
};

const ProviderListPage: React.FC<ProviderListPageProps> = ({
  workspace,
  onSelect,
  renderCredentialInput,
}) => {
  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const providers = useProviders(workspace);
  const { addSuccess } = useAlerts();
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isActionsOpen, setActionsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const bulkDelete = useBulkDelete(
    (name) => deleteProvider(workspace, name),
    ['providers', workspace],
  );

  if (providers.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading providers" />
      </Bullseye>
    );
  }

  if (providers.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load providers"
        actionLinks={
          <Button variant="link" onClick={() => providers.refetch()}>
            Retry
          </Button>
        }
      >
        {(providers.error as Error).message}
      </Alert>
    );
  }

  const allRows = providers.data ?? [];
  const totalCount = allRows.length;
  const startIndex = (page - 1) * perPage;
  const pageRows = allRows.slice(startIndex, startIndex + perPage);
  const pageNames = pageRows.map((p) => p.metadata.name);
  const numSelected = selected.length;
  const pageAllSelected =
    pageNames.length > 0 && pageNames.every((n) => selected.includes(n));

  const toggleAll = (isSelecting: boolean) => {
    setSelected(isSelecting ? pageNames : []);
  };

  const closeDeleteModal = () => {
    bulkDelete.clearError();
    setDeleteTargets(null);
  };

  if (totalCount === 0) {
    return (
      <>
        <EmptyState variant="lg" titleText="No providers" icon={PlusCircleIcon}>
          <EmptyStateBody>
            Providers register inference endpoints and service credentials
            (Anthropic, NVIDIA NIM, GitLab, ...) that sandboxes can use.
          </EmptyStateBody>
          {isWorkspaceAdmin && (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  onClick={() => setCreateOpen(true)}
                  data-testid="create-provider-empty"
                >
                  Add provider
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          )}
        </EmptyState>
        <CreateProviderModal
          workspace={workspace}
          isOpen={isCreateOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => addSuccess('Provider created')}
          renderCredentialInput={resolvedCredentialInput}
        />
      </>
    );
  }

  return (
    <>
      <Toolbar aria-label="Provider actions">
        <ToolbarContent>
          {isWorkspaceAdmin && (
            <ToolbarItem>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-provider"
              >
                Add provider
              </Button>
            </ToolbarItem>
          )}
          {isWorkspaceAdmin && (
            <ToolbarItem>
              <Dropdown
                isOpen={isActionsOpen}
                onOpenChange={setActionsOpen}
                onSelect={() => setActionsOpen(false)}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    variant="plain"
                    onClick={() => setActionsOpen((prev) => !prev)}
                    isExpanded={isActionsOpen}
                    aria-label="Actions"
                    data-testid="provider-actions-kebab"
                  >
                    <EllipsisVIcon />
                  </MenuToggle>
                )}
              >
                <DropdownList>
                  <DropdownItem
                    key="delete-selected"
                    isDisabled={numSelected === 0}
                    onClick={() => setDeleteTargets(selected)}
                    data-testid="delete-selected-providers"
                  >
                    Delete selected{numSelected > 0 ? ` (${numSelected})` : ''}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
          )}
          <ToolbarItem align={{ default: 'alignEnd' }}>
            <Pagination
              itemCount={totalCount}
              perPage={perPage}
              page={page}
              onSetPage={(_event, p) => setPage(p)}
              onPerPageSelect={(_event, pp) => {
                setPerPage(pp);
                setPage(1);
              }}
              isCompact
            />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      <Table aria-label="Providers" data-testid="provider-table">
        <Thead>
          <Tr>
            {isWorkspaceAdmin && (
              <Th
                select={{
                  onSelect: (_event, isSelecting) => toggleAll(isSelecting),
                  isSelected: pageAllSelected,
                }}
                aria-label="Select all providers"
              />
            )}
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Credentials</Th>
            <Th>Age</Th>
            {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
          </Tr>
        </Thead>
        <Tbody>
          {pageRows.map((provider, rowIndex) => (
            <Tr key={provider.metadata.name}>
              {isWorkspaceAdmin && (
                <Td
                  select={{
                    rowIndex,
                    onSelect: (_event, isSelecting) =>
                      setSelected((current) =>
                        isSelecting
                          ? [...current, provider.metadata.name]
                          : current.filter(
                              (item) => item !== provider.metadata.name,
                            ),
                      ),
                    isSelected: selected.includes(provider.metadata.name),
                  }}
                />
              )}
              <Td dataLabel="Name" modifier="truncate">
                <Tooltip content={provider.metadata.name}>
                  <Button
                    variant="link"
                    isInline
                    onClick={() => onSelect?.(provider.metadata.name)}
                    data-testid={`provider-link-${provider.metadata.name}`}
                  >
                    {provider.metadata.name}
                  </Button>
                </Tooltip>
              </Td>
              <Td dataLabel="Type">
                <Label color="purple">{provider.type}</Label>
              </Td>
              <Td dataLabel="Credentials">
                {(provider.credentialNames ?? []).length > 0 ? (
                  <LabelGroup>
                    {(provider.credentialNames ?? []).map((name) => (
                      <Label key={name} color="grey" isCompact>
                        {name}
                      </Label>
                    ))}
                  </LabelGroup>
                ) : (
                  '-'
                )}
              </Td>
              <Td dataLabel="Age">
                {formatAge(provider.metadata.createdAtMs)}
              </Td>
              {isWorkspaceAdmin && (
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      {
                        title: 'Delete',
                        onClick: () =>
                          setDeleteTargets([provider.metadata.name]),
                      },
                    ]}
                  />
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>
      <CreateProviderModal
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => addSuccess('Provider created')}
        renderCredentialInput={renderCredentialInput}
      />
      <ConfirmDeleteModal
        title={
          deleteTargets && deleteTargets.length > 1
            ? 'Delete providers?'
            : 'Delete provider?'
        }
        body={
          deleteTargets && deleteTargets.length > 1
            ? `${deleteTargets.length} providers will be deleted. Sandboxes using them lose access to their credentials.`
            : `Provider "${deleteTargets?.[0] ?? ''}" will be deleted. Sandboxes using it lose access to its credentials.`
        }
        confirmName={deleteTargets?.length === 1 ? deleteTargets[0] : undefined}
        isOpen={deleteTargets !== null}
        isDeleting={bulkDelete.isDeleting}
        error={bulkDelete.error}
        onConfirm={() => {
          if (deleteTargets) {
            bulkDelete.run(deleteTargets, () => {
              addSuccess(
                deleteTargets.length > 1
                  ? `${deleteTargets.length} providers deleted`
                  : `Provider "${deleteTargets[0]}" deleted`,
              );
              setSelected((current) =>
                current.filter((name) => !deleteTargets.includes(name)),
              );
              closeDeleteModal();
            });
          }
        }}
        onCancel={closeDeleteModal}
      />
    </>
  );
};

export default ProviderListPage;
