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
import { useWorkspaceDraftSummary } from '../api/draftSummary';
import { useSandboxPolicies } from '../api/policy';
import { useProviderExpiry } from '../api/providers';
import { sandboxKeys } from '../api/queryKeys';
import {
  deleteSandbox,
  useSandboxes,
  useStartSandbox,
  useStopSandbox,
} from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CreateSandboxModal from '../components/CreateSandboxModal';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import SandboxGalleryView from '../components/sandbox/SandboxGalleryView';
import SandboxTableRow from '../components/sandbox/SandboxTableRow';
import { useBulkDelete } from '../hooks/useBulkDelete';
import { useListPage } from '../hooks/useListPage';
import { describeDeletions, type ResourceNoun } from '../utils/deletion';
import { hasPolicyRevision } from '../utils/sandboxLifecycle';
import type { Sandbox } from '../types';

const SANDBOX_NOUN: ResourceNoun = { singular: 'sandbox', plural: 'sandboxes' };

const sandboxName = (sandbox: Sandbox): string => sandbox.metadata.name;

// How many of the sandboxes a bulk delete names are spelled out in the
// question before it. The rest are counted.
const NAMED_DELETE_TARGETS = 10;

// What a bulk delete is about to delete, by name. The selection can hold
// sandboxes of another page of the list, so the question names them: nothing
// is deleted that the question did not show.
const describeDeleteTargets = (names: string[]): string => {
  const listed = names.slice(0, NAMED_DELETE_TARGETS).join(', ');
  const unlisted = names.length - NAMED_DELETE_TARGETS;
  return `${names.length} sandboxes will be permanently deleted: ${listed}${
    unlisted > 0 ? ` and ${unlisted} more` : ''
  }. This cannot be undone.`;
};

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
  // The label selector as typed, and the one the list was last asked for
  // (`openshell sandbox list --selector`). The gateway does the filtering and
  // refuses a selector that is not key=value pairs, so it is sent when the
  // search is submitted, not on every key.
  const [selectorInput, setSelectorInput] = useState('');
  const [labelSelector, setLabelSelector] = useState('');
  const sandboxes = useSandboxes(workspace, labelSelector || undefined);
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
    pageOf,
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
  // The rows of the page being shown. Taking them from pageOf keeps the page
  // inside a list that got shorter, and drops from the selection a sandbox
  // that a filter has hidden or that is gone: see useTableSelection.
  const rows = pageOf(filteredSandboxes, sandboxName);
  // The sandboxes on this page whose policy can be read. One that was just
  // created has no policy revision until its supervisor has started, and the
  // gateway answers a request for it with a 404; see hasPolicyRevision.
  const policyNames = rows.filter(hasPolicyRevision).map(sandboxName);
  const policyViews = useSandboxPolicies(workspace, policyNames);
  const providerExpiry = useProviderExpiry(workspace);
  const drafts = useWorkspaceDraftSummary(workspace, features.draftPolicy);
  const { addAlert, addSuccess, addDanger } = useAlerts();
  const stopSandbox = useStopSandbox(workspace);
  const startSandbox = useStartSandbox(workspace);
  const bulkDelete = useBulkDelete(
    (name) => deleteSandbox(workspace, name),
    sandboxKeys.scope(workspace),
  );

  if (sandboxes.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading sandboxes" />
      </Bullseye>
    );
  }

  const applySelector = (selector: string) => {
    setSelectorInput(selector);
    setLabelSelector(selector.trim());
    setPage(1);
  };

  // The list is re-read while the page is open. A refresh that fails leaves
  // the list, and a form or a dialog open over it, as they were, with a note
  // above; only a list that never loaded is replaced by the error. A failure
  // of the filtered list is shown beside the filter, where the selector that
  // caused it can be corrected.
  const refreshFailed = isRefreshError(sandboxes);
  const loadFailed = sandboxes.isError && !refreshFailed;
  if (loadFailed && !labelSelector) {
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
  const pageNames = rows.map(sandboxName);

  // With a selector applied an empty list is a filter that matches nothing,
  // and the filter stays on screen to be changed.
  const isEmpty = allRows.length === 0 && !labelSelector;

  const emptyState = (
    <EmptyState variant="lg" titleText="No sandboxes" icon={CubesIcon}>
      <EmptyStateBody>
        Sandboxes are secure execution environments for agents and tools. Create
        one to get started.
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
  );

  const list = (
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
          <ToolbarItem>
            <SearchInput
              aria-label="Filter sandboxes by label selector"
              placeholder="Label selector, e.g. team=ml"
              value={selectorInput}
              onChange={(_event, value) => setSelectorInput(value)}
              onSearch={(_event, value) => applySelector(value)}
              onClear={() => applySelector('')}
              submitSearchButtonLabel="Apply label selector"
              resetButtonLabel="Clear label selector"
              data-testid="sandbox-label-selector"
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
      {loadFailed && (
        <Alert
          variant="danger"
          isInline
          title="The label selector could not be applied"
          data-testid="sandbox-label-selector-error"
        >
          {(sandboxes.error as Error).message}
        </Alert>
      )}
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
              <Th>Created</Th>
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
                draftSummary={drafts.bySandbox[sandbox.metadata.name]}
                onReviewDrafts={
                  features.draftPolicy
                    ? () => viewSandbox(sandbox.metadata.name, 'proposals')
                    : undefined
                }
              />
            ))}
            {rows.length === 0 && !loadFailed && (
              <Tr>
                <Td colSpan={8}>No sandboxes match this filter.</Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      ) : rows.length === 0 ? (
        // The gallery's own empty state invites creating a first sandbox,
        // which is not what a filter that matches nothing calls for.
        !loadFailed && (
          <EmptyState
            variant="sm"
            titleText="No sandboxes match this filter"
            headingLevel="h4"
            data-testid="sandbox-gallery-no-match"
          />
        )
      ) : (
        <SandboxGalleryView
          sandboxes={rows}
          draftSummaries={drafts.items}
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
    </>
  );

  // The empty state and the list take turns in one place, and the dialogs
  // follow in places of their own. A poll that takes the list from empty to
  // not empty, or back, then swaps what is in that one place and leaves an
  // open Create sandbox form, and what was typed into it, where it is.
  return (
    <>
      {refreshFailed && (
        <RefreshErrorAlert
          title="The sandboxes could not be refreshed"
          error={sandboxes.error}
          onRetry={() => sandboxes.refetch()}
          className="pf-v6-u-mb-md"
          data-testid="sandboxes-refresh-error"
        />
      )}
      {isEmpty ? emptyState : list}
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
            ? describeDeleteTargets(deleteTargets)
            : `Sandbox "${deleteTargets?.[0] ?? ''}" will be permanently deleted. This cannot be undone.`
        }
        confirmName={deleteTargets?.length === 1 ? deleteTargets[0] : undefined}
        isOpen={deleteTargets !== null}
        isDeleting={bulkDelete.isDeleting}
        error={bulkDelete.error}
        onConfirm={() => {
          if (deleteTargets) {
            bulkDelete.run(deleteTargets, (outcomes) => {
              // What the gateway did, which is often only to accept the
              // delete and clean up afterwards.
              const notice = describeDeletions(
                SANDBOX_NOUN,
                deleteTargets,
                outcomes,
              );
              addAlert(notice.title, notice.variant);
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
