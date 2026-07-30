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
  MenuToggle,
  Pagination,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import { CubesIcon, EllipsisVIcon } from '@patternfly/react-icons';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { deleteSandbox, useSandboxes } from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CreateSandboxModal from '../components/CreateSandboxModal';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import { useBulkDelete } from '../components/useBulkDelete';
import { formatAge } from '../components/utils';

type SandboxListPageProps = {
  workspace: string;
  onSelect?: (name: string) => void;
};

const SandboxListPage: React.FC<SandboxListPageProps> = ({ workspace, onSelect }) => {
  const sandboxes = useSandboxes(workspace);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isActionsOpen, setActionsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const { addSuccess } = useAlerts();
  const bulkDelete = useBulkDelete(
    (name) => deleteSandbox(workspace, name),
    ['sandboxes', workspace],
  );

  if (sandboxes.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading sandboxes" />
      </Bullseye>
    );
  }

  if (sandboxes.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load sandboxes"
        actionLinks={
          <Button variant="link" onClick={() => sandboxes.refetch()}>
            Retry
          </Button>
        }
      >
        {(sandboxes.error as Error).message}
      </Alert>
    );
  }

  const allRows = sandboxes.data ?? [];
  const totalCount = allRows.length;
  const startIndex = (page - 1) * perPage;
  const rows = allRows.slice(startIndex, startIndex + perPage);
  const pageNames = rows.map((sandbox) => sandbox.metadata.name);

  const numSelected = selected.length;
  const pageAllSelected = pageNames.length > 0 && pageNames.every((n) => selected.includes(n));

  const toggleAll = (isSelecting: boolean) => {
    setSelected(isSelecting ? pageNames : []);
  };

  const toggleOne = (name: string, isSelecting: boolean) => {
    setSelected((current) =>
      isSelecting ? [...current, name] : current.filter((item) => item !== name),
    );
  };

  const closeDeleteModal = () => {
    bulkDelete.clearError();
    setDeleteTargets(null);
  };

  if (allRows.length === 0) {
    return (
      <>
        <EmptyState variant="lg" titleText="No sandboxes" icon={CubesIcon}>
          <EmptyStateBody>
            Sandboxes are secure execution environments for agents and tools. Create one to get
            started.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button onClick={() => setCreateOpen(true)} data-testid="create-sandbox-empty">
                Create sandbox
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
        <CreateSandboxModal
          workspace={workspace}
          isOpen={isCreateOpen}
          onClose={() => setCreateOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <Toolbar aria-label="Sandbox actions">
        <ToolbarContent>
          <ToolbarItem>
            <Button onClick={() => setCreateOpen(true)} data-testid="create-sandbox">
              Create sandbox
            </Button>
          </ToolbarItem>
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
                  data-testid="sandbox-actions-kebab"
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
                  data-testid="delete-selected-sandboxes"
                >
                  Delete selected{numSelected > 0 ? ` (${numSelected})` : ''}
                </DropdownItem>
              </DropdownList>
            </Dropdown>
          </ToolbarItem>
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
      <Table aria-label="Sandboxes" data-testid="sandbox-table">
        <Thead>
          <Tr>
            <Th
              select={{
                onSelect: (_event, isSelecting) => toggleAll(isSelecting),
                isSelected: pageAllSelected,
              }}
              aria-label="Select all sandboxes"
            />
            <Th>Name</Th>
            <Th>Phase</Th>
            <Th>Image</Th>
            <Th>Labels</Th>
            <Th>Age</Th>
            <Th screenReaderText="Actions" />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((sandbox, rowIndex) => (
            <Tr key={sandbox.metadata.name}>
              <Td
                select={{
                  rowIndex,
                  onSelect: (_event, isSelecting) =>
                    toggleOne(sandbox.metadata.name, isSelecting),
                  isSelected: selected.includes(sandbox.metadata.name),
                }}
              />
              <Td dataLabel="Name">
                <Button
                  variant="link"
                  isInline
                  onClick={() => onSelect?.(sandbox.metadata.name)}
                  data-testid={`sandbox-link-${sandbox.metadata.name}`}
                >
                  {sandbox.metadata.name}
                </Button>
              </Td>
              <Td dataLabel="Phase">
                <PhaseLabel phase={sandbox.status.phase} />
              </Td>
              <Td dataLabel="Image" modifier="truncate">
                <Tooltip content={sandbox.spec.image || '-'}>
                  <span>{sandbox.spec.image || '-'}</span>
                </Tooltip>
              </Td>
              <Td dataLabel="Labels">
                <LabelsList labels={sandbox.metadata.labels} />
              </Td>
              <Td dataLabel="Age">{formatAge(sandbox.metadata.createdAtMs)}</Td>
              <Td isActionCell>
                <ActionsColumn
                  items={[
                    {
                      title: 'Delete',
                      onClick: () => setDeleteTargets([sandbox.metadata.name]),
                    },
                  ]}
                />
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={7}>No sandboxes match this filter.</Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      <CreateSandboxModal
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ConfirmDeleteModal
        title={deleteTargets && deleteTargets.length > 1 ? 'Delete sandboxes?' : 'Delete sandbox?'}
        body={
          deleteTargets && deleteTargets.length > 1
            ? `${deleteTargets.length} sandboxes will be permanently deleted. This is the only way to stop running sandboxes.`
            : `Sandbox "${deleteTargets?.[0] ?? ''}" will be permanently deleted. This is the only way to stop a running sandbox.`
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
                  ? `${deleteTargets.length} sandboxes deleted`
                  : `Sandbox "${deleteTargets[0]}" deleted`,
              );
              setSelected([]);
              closeDeleteModal();
            });
          }
        }}
        onCancel={closeDeleteModal}
      />
    </>
  );
};

export default SandboxListPage;
