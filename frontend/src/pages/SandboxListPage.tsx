import { useMemo, useState } from 'react';
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
  SearchInput,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  CubesIcon,
  EllipsisVIcon,
  ListIcon,
  ThIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useNavigate } from 'react-router-dom';

import { useFeatureFlags } from '../api/auth';
import { useDraftNotifications, useSandboxPolicies } from '../api/policy';
import { useProviderExpiry } from '../api/providers';
import {
  deleteSandbox,
  useSandboxes,
  useStartSandbox,
  useStopSandbox,
} from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CreateSandboxModal from '../components/CreateSandboxModal';
import SandboxGalleryView from '../components/sandbox/SandboxGalleryView';
import SandboxTableRow from '../components/sandbox/SandboxTableRow';
import { useBulkDelete } from '../hooks/useBulkDelete';
import { useListPage } from '../hooks/useListPage';

type ViewMode = 'list' | 'cards';

const VIEW_MODE_KEY = 'sandboxViewMode';

const getInitialViewMode = (): ViewMode => {
  const stored = localStorage.getItem(VIEW_MODE_KEY);
  return stored === 'cards' ? 'cards' : 'list';
};

type SandboxListPageProps = {
  workspace: string;
  onSelect?: (name: string) => void;
  onViewSandbox?: (name: string, tab?: string) => void;
  toolbarStart?: React.ReactNode;
  createActionPosition?: 'start' | 'end';
  compactToolbar?: boolean;
};

const SandboxListPage: React.FC<SandboxListPageProps> = ({
  workspace,
  onSelect,
  onViewSandbox,
  toolbarStart,
  createActionPosition = 'start',
  compactToolbar = false,
}) => {
  const navigate = useNavigate();
  const viewSandbox = (name: string, tab?: string) => {
    if (onViewSandbox) {
      onViewSandbox(name, tab);
    } else {
      const tabParam = tab ? `?tab=${tab}` : '';
      navigate(`/workspaces/${workspace}/sandboxes/${name}${tabParam}`);
    }
  };
  const features = useFeatureFlags();
  const sandboxes = useSandboxes(workspace);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
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
  const filteredSandboxes = useMemo(() => {
    const all = sandboxes.data ?? [];
    const normalizedFilter = nameFilter.trim().toLocaleLowerCase();
    if (!normalizedFilter) {
      return all;
    }
    return all.filter((sandbox) =>
      sandbox.metadata.name.toLocaleLowerCase().includes(normalizedFilter),
    );
  }, [sandboxes.data, nameFilter]);
  const visibleNames = useMemo(() => {
    const all = filteredSandboxes;
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage).map((s) => s.metadata.name);
  }, [filteredSandboxes, page, perPage]);
  const policyViews = useSandboxPolicies(workspace, visibleNames);
  const providerExpiry = useProviderExpiry(workspace);
  const drafts = useDraftNotifications(features.draftPolicy);
  const { addSuccess, addDanger } = useAlerts();
  const stopSandbox = useStopSandbox(workspace);
  const startSandbox = useStartSandbox(workspace);
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
  const totalCount = filteredSandboxes.length;
  const startIndex = (page - 1) * perPage;
  const rows = filteredSandboxes.slice(startIndex, startIndex + perPage);
  const pageNames = rows.map((sandbox) => sandbox.metadata.name);

  if (allRows.length === 0) {
    return (
      <>
        <EmptyState variant="lg" titleText="No sandboxes" icon={CubesIcon}>
          <EmptyStateBody>
            Sandboxes are secure execution environments for agents and tools.
            Create one to get started.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-sandbox-empty"
              >
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
          {createActionPosition === 'start' && (
            <ToolbarItem>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-sandbox"
              >
                Create sandbox
              </Button>
            </ToolbarItem>
          )}
          {toolbarStart && <ToolbarItem>{toolbarStart}</ToolbarItem>}
          <ToolbarItem>
            <SearchInput
              aria-label="Filter sandboxes by name"
              placeholder="Filter by name"
              value={nameFilter}
              onChange={(_event, value) => {
                setNameFilter(value);
                setPage(1);
              }}
              onClear={() => {
                setNameFilter('');
                setPage(1);
              }}
            />
          </ToolbarItem>
          {!compactToolbar && (
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
                    {deleteSelectedLabel}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
          )}
          {!compactToolbar && (
            <ToolbarItem>
              <ToggleGroup aria-label="View type" data-testid="view-toggle">
                <ToggleGroupItem
                  text=""
                  icon={<ListIcon />}
                  aria-label="List view"
                  isSelected={viewMode === 'list'}
                  onChange={() => {
                    setViewMode('list');
                    localStorage.setItem(VIEW_MODE_KEY, 'list');
                  }}
                  data-testid="view-toggle-list"
                />
                <ToggleGroupItem
                  text=""
                  icon={<ThIcon />}
                  aria-label="Card view"
                  isSelected={viewMode === 'cards'}
                  onChange={() => {
                    setViewMode('cards');
                    localStorage.setItem(VIEW_MODE_KEY, 'cards');
                  }}
                  data-testid="view-toggle-cards"
                />
              </ToggleGroup>
            </ToolbarItem>
          )}
          <ToolbarItem>
            <Pagination
              itemCount={totalCount}
              perPage={perPage}
              page={page}
              onSetPage={(_event, p) => setPage(p)}
              onPerPageSelect={(_event, pp) => onPerPageSelect(pp)}
              isCompact
            />
          </ToolbarItem>
          {createActionPosition === 'end' && (
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-sandbox"
              >
                Create sandbox
              </Button>
            </ToolbarItem>
          )}
        </ToolbarContent>
      </Toolbar>
      {compactToolbar || viewMode === 'list' ? (
        <Table aria-label="Sandboxes" data-testid="sandbox-table">
          <Thead>
            <Tr>
              <Th
                select={{
                  onSelect: (_event, isSelecting) =>
                    toggleAll(pageNames, isSelecting),
                  isSelected: pageAllSelected(pageNames),
                }}
                aria-label="Select all sandboxes"
              />
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Policy</Th>
              <Th>Providers</Th>
              <Th>Labels</Th>
              <Th>Age</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((sandbox, rowIndex) => (
              <SandboxTableRow
                key={sandbox.metadata.name}
                sandbox={sandbox}
                rowIndex={rowIndex}
                isSelected={selected.includes(sandbox.metadata.name)}
                onSelect={(isSelecting) =>
                  toggleOne(sandbox.metadata.name, isSelecting)
                }
                onNameClick={() => onSelect?.(sandbox.metadata.name)}
                onDelete={() => setDeleteTargets([sandbox.metadata.name])}
                onStop={() =>
                  stopSandbox.mutate(sandbox.metadata.name, {
                    onSuccess: () =>
                      addSuccess(`Stopping sandbox ${sandbox.metadata.name}`),
                    onError: (err) =>
                      addDanger(
                        `Failed to stop sandbox ${sandbox.metadata.name}: ${(err as Error).message}`,
                      ),
                  })
                }
                onStart={() =>
                  startSandbox.mutate(sandbox.metadata.name, {
                    onSuccess: () =>
                      addSuccess(`Starting sandbox ${sandbox.metadata.name}`),
                    onError: (err) =>
                      addDanger(
                        `Failed to start sandbox ${sandbox.metadata.name}: ${(err as Error).message}`,
                      ),
                  })
                }
                onViewLogs={() => viewSandbox(sandbox.metadata.name, 'logs')}
                onOpenTerminal={
                  sandbox.status.phase === 'READY' && features.terminal
                    ? () => viewSandbox(sandbox.metadata.name, 'terminal')
                    : undefined
                }
                policyView={policyViews[sandbox.metadata.name]}
              />
            ))}
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={8}>No sandboxes match this filter.</Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      ) : (
        <SandboxGalleryView
          sandboxes={rows}
          draftSummaries={drafts.items.filter((d) => d.workspace === workspace)}
          policyViews={policyViews}
          providerExpiry={providerExpiry}
          onDelete={(name) => setDeleteTargets([name])}
          onSelect={onSelect}
          onViewLogs={(name) => viewSandbox(name, 'logs')}
          onOpenTerminal={
            features.terminal
              ? (name) => viewSandbox(name, 'terminal')
              : undefined
          }
          onReviewDrafts={
            features.draftPolicy
              ? (name) => viewSandbox(name, 'proposals')
              : undefined
          }
          onCreateClick={() => setCreateOpen(true)}
        />
      )}
      <CreateSandboxModal
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ConfirmDeleteModal
        title={
          deleteTargets && deleteTargets.length > 1
            ? 'Delete sandboxes?'
            : 'Delete sandbox?'
        }
        body={
          deleteTargets && deleteTargets.length > 1
            ? `${deleteTargets.length} sandboxes will be permanently deleted. This cannot be undone.`
            : `Sandbox "${deleteTargets?.[0] ?? ''}" will be permanently deleted. This cannot be undone.`
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

export default SandboxListPage;
