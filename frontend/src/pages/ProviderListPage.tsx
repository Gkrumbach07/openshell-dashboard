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
import { useWorkspaceRole } from '../api/rbac';
import { useSlots } from '../slots';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import ProviderFormModal from '../components/provider/ProviderFormModal';
import { useBulkDelete } from '../hooks/useBulkDelete';
import { useListPage } from '../hooks/useListPage';
import { formatAge } from '../utils/formatters';
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
  const {
    page,
    setPage,
    perPage,
    onPerPageSelect,
    selected,
    numSelected,
    toggleAll,
    toggleOne,
    pageAllSelected,
    clearSelection,
    isActionsOpen,
    setActionsOpen,
    deleteTargets,
    setDeleteTargets,
    closeDeleteModal,
    deleteSelectedLabel,
  } = useListPage();

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
        <ProviderFormModal
          mode="create"
          workspace={workspace}
          isOpen={isCreateOpen}
          onClose={() => setCreateOpen(false)}
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
                    {deleteSelectedLabel}
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
              onPerPageSelect={(_event, pp) => onPerPageSelect(pp)}
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
                  onSelect: (_event, isSelecting) => toggleAll(pageNames, isSelecting),
                  isSelected: pageAllSelected(pageNames),
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
                      toggleOne(provider.metadata.name, isSelecting),
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
      <ProviderFormModal
        mode="create"
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
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
              clearSelection();
              closeDeleteModal();
            });
          }
        }}
        onCancel={() => {
          bulkDelete.clearError();
          closeDeleteModal();
        }}
      />
    </>
  );
};

export default ProviderListPage;
