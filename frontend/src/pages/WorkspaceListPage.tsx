import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  MenuToggle,
  PageSection,
  SearchInput,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarToggleGroup,
} from '@patternfly/react-core';
import { CubesIcon, EllipsisVIcon, FilterIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { deleteWorkspace, useWorkspacePage } from '../api/workspaces';
import { allWorkspacesKeys, workspaceKeys } from '../api/queryKeys';
import { useAlerts } from '../app/AlertContext';
import { useUserRole } from '../api/rbac';
import CreateWorkspaceModal from '../components/CreateWorkspaceModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CursorPagination from '../components/CursorPagination';
import CursorPageTransition from '../components/CursorPageTransition';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import { useBulkDelete } from '../hooks/useBulkDelete';
import {
  isCursorPagePending,
  useCursorListPage,
  useCursorPageResult,
} from '../hooks/useCursorListPage';
import { useCursorSelection } from '../hooks/useCursorSelection';
import { useI18n } from '../i18n';
import { formatAge } from '../utils/formatters';

type WorkspaceListPageProps = {
  onSelect?: (name: string) => void;
  renderWorkspaceHeader?: () => React.ReactNode;
};

// A workspace the gateway did not delete, and why.
type DeleteFailure = {
  name: string;
  message: string;
};

const WorkspaceListPage: React.FC<WorkspaceListPageProps> = ({
  onSelect,
  renderWorkspaceHeader,
}) => {
  const { t } = useI18n('workspaces');
  const { t: tCommon } = useI18n('common');
  // The selector as typed, and the one the list was last asked for. The
  // gateway does the filtering and refuses a selector that is not key=value
  // pairs, so it is sent when the search is submitted, not on every key.
  const [selectorInput, setSelectorInput] = useState('');
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [labelSelector, setLabelSelector] = useState('');
  const queryClient = useQueryClient();
  const { addSuccess } = useAlerts();
  const { isPlatformAdmin } = useUserRole();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const {
    page,
    pageToken,
    reset,
    next,
    previous,
    perPage,
    onPerPageSelect,
    isTransitioning,
    markLoaded,
  } = useCursorListPage(labelSelector);
  const {
    selected,
    toggleAll,
    toggleOne,
    pageAllSelected,
    reconcilePage,
    clearSelection,
  } = useCursorSelection(labelSelector);
  const [isActionsOpen, setActionsOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const closeDeleteModal = () => setDeleteTargets(null);
  const workspaces = useWorkspacePage({
    pageSize: perPage,
    pageToken,
    labelSelector: labelSelector || undefined,
  });
  useCursorPageResult({ page, markLoaded, reset }, workspaces);
  useEffect(() => {
    if (!workspaces.data || workspaces.isFetching || workspaces.isError) return;
    reconcilePage(
      `${perPage}\0${pageToken}`,
      workspaces.data.items.map((workspace) => workspace.metadata.name),
    );
  }, [
    workspaces.data,
    workspaces.isFetching,
    workspaces.isError,
    perPage,
    pageToken,
    reconcilePage,
  ]);

  // `openshell workspace delete <names...>`: one delete per workspace. The
  // reason the gateway gives for each one it refuses is kept, so that a
  // delete that fails says which workspace and why.
  const failures = useRef<DeleteFailure[]>([]);
  const [failedDeletes, setFailedDeletes] = useState<DeleteFailure[]>([]);
  const bulkDelete = useBulkDelete(
    (name) =>
      deleteWorkspace(name).catch((error: unknown) => {
        failures.current.push({ name, message: (error as Error).message });
        throw error;
      }),
    workspaceKeys.all,
  );

  const applySelector = (selector: string) => {
    setSelectorInput(selector);
    setLabelSelector(selector.trim());
    // A workspace the new filter hides must not stay selected: it would be
    // deleted without being on screen.
    clearSelection();
  };

  // The list is polled. A refresh that fails leaves the workspaces that
  // loaded before on screen, with a note above them; only a list that never
  // loaded takes the page.
  const refreshFailed = isRefreshError(workspaces);
  const pageFailed = workspaces.isError && page > 1;

  // A failure of the filtered list is shown beside the filter, where the
  // selector that caused it can be corrected.
  if (workspaces.isError && !labelSelector && !refreshFailed && page === 1) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={t('loadFailed')}
          actionLinks={
            <Button variant="link" onClick={() => workspaces.refetch()}>
              {tCommon('actions.retry')}
            </Button>
          }
        >
          {(workspaces.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const allRows = workspaces.data?.items ?? [];
  const rows = allRows;
  const pageNames = rows.map((workspace) => workspace.metadata.name);
  // Selected names can belong to earlier pages, which are no longer loaded.
  const selectedNames = selected;

  const targets = deleteTargets ?? [];
  const isBulk = targets.length > 1;
  // Deleting a workspace deletes everything in it, so the name has to be
  // typed. Several at once take a phrase that says how many instead.
  const confirmPhrase = isBulk
    ? t('bulkDelete.confirmPhrase', { total: targets.length })
    : targets[0];

  // The gateway's own reason for each workspace it did not delete. One
  // workspace needs no name in front of it.
  let deleteError: string | undefined;
  if (failedDeletes.length === 1 && !isBulk) {
    deleteError = failedDeletes[0].message;
  } else if (failedDeletes.length > 0) {
    deleteError = failedDeletes
      .map((failure) => `${failure.name}: ${failure.message}`)
      .join('; ');
  }

  const openDelete = (names: string[]) => {
    bulkDelete.clearError();
    setFailedDeletes([]);
    setDeleteTargets(names);
  };

  const closeDelete = () => {
    bulkDelete.clearError();
    setFailedDeletes([]);
    closeDeleteModal();
  };

  const confirmDelete = async () => {
    const names = targets;
    if (names.length === 0) return;
    failures.current = [];
    setFailedDeletes([]);
    await bulkDelete.run(names, () => {
      addSuccess(
        names.length > 1
          ? t('bulkDelete.toast', { total: names.length })
          : t('delete.toast', { name: names[0] }),
      );
      clearSelection();
      closeDeleteModal();
    });
    // What the lists across workspaces showed of a deleted workspace is gone
    // with it, whether or not every delete went through.
    await queryClient.invalidateQueries({ queryKey: allWorkspacesKeys.all });

    const failed = failures.current;
    if (failed.length === 0) return;
    // Some went through and are gone for good. What is left to decide about
    // is the rest, so the question is asked again about those alone.
    const failedNames = failed.map((failure) => failure.name);
    const deleted = names.filter((name) => !failedNames.includes(name));
    if (deleted.length > 0) {
      addSuccess(t('bulkDelete.toastSome', { names: deleted.join(', ') }));
    }
    setFailedDeletes(failed);
    setDeleteTargets(failedNames);
  };

  const paginationProps = {
    perPage,
    page,
    hasNext: Boolean(workspaces.data?.nextPageToken),
    isLoading: isCursorPagePending(workspaces, isTransitioning),
    isError: workspaces.isError,
    onPrevious: previous,
    onNext: () => next(workspaces.data?.nextPageToken ?? ''),
    onPerPageSelect,
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          {t('title')}
        </Title>
        <Content component="p">{t('description')}</Content>
      </PageSection>
      {renderWorkspaceHeader && (
        <PageSection>{renderWorkspaceHeader()}</PageSection>
      )}
      <PageSection>
        {refreshFailed && !pageFailed && (
          <RefreshErrorAlert
            title={t('refreshFailed.title')}
            staleNote={t('refreshFailed.stale')}
            retryLabel={tCommon('actions.retry')}
            error={workspaces.error}
            onRetry={() => workspaces.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="workspace-refresh-error"
          />
        )}
        {allRows.length === 0 &&
        !workspaces.isLoading &&
        !workspaces.isPlaceholderData &&
        !labelSelector &&
        page === 1 &&
        !workspaces.isError ? (
          <EmptyState
            titleText={t('empty.title')}
            icon={CubesIcon}
            variant="xl"
          >
            <EmptyStateBody>
              {isPlatformAdmin ? t('empty.body') : t('empty.bodyMember')}
            </EmptyStateBody>
            {isPlatformAdmin && (
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button
                    onClick={() => setCreateOpen(true)}
                    data-testid="create-workspace-empty"
                  >
                    {t('create')}
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            )}
          </EmptyState>
        ) : (
          <>
            <Toolbar aria-label={t('actionsToolbar')}>
              <ToolbarContent>
                <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="lg">
                  <ToolbarItem>
                    <SearchInput
                      aria-label={t('filter.label')}
                      placeholder={t('filter.placeholder')}
                      value={selectorInput}
                      onChange={(_event, value) => setSelectorInput(value)}
                      onSearch={(_event, value) => applySelector(value)}
                      onClear={() => applySelector('')}
                      submitSearchButtonLabel={t('filter.apply')}
                      resetButtonLabel={t('filter.clear')}
                      data-testid="workspace-label-filter"
                    />
                  </ToolbarItem>
                </ToolbarToggleGroup>
                {isPlatformAdmin && (
                  <ToolbarItem>
                    <Button
                      onClick={() => setCreateOpen(true)}
                      data-testid="create-workspace"
                    >
                      {t('create')}
                    </Button>
                  </ToolbarItem>
                )}
                {isPlatformAdmin && (
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
                          aria-label={t('bulkDelete.menu')}
                          data-testid="workspace-actions-kebab"
                        >
                          <EllipsisVIcon />
                        </MenuToggle>
                      )}
                    >
                      <DropdownList>
                        <DropdownItem
                          key="delete-selected"
                          isDisabled={
                            selectedNames.length === 0 || isTransitioning
                          }
                          onClick={() => openDelete(selectedNames)}
                          data-testid="delete-selected-workspaces"
                        >
                          {selectedNames.length > 0
                            ? t('bulkDelete.actionCount', {
                                total: selectedNames.length,
                              })
                            : t('bulkDelete.action')}
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </ToolbarItem>
                )}
                <ToolbarItem
                  variant="pagination"
                  align={{ default: 'alignEnd' }}
                >
                  <CursorPagination variant="top" {...paginationProps} />
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>
            {(workspaces.isError && !refreshFailed) || pageFailed ? (
              <Alert
                variant="danger"
                isInline
                title={
                  page > 1 ? t('pagination.loadFailed') : t('filter.failed')
                }
                data-testid="workspace-label-filter-error"
              >
                {(workspaces.error as Error).message}
                {page > 1 && (
                  <Button variant="link" onClick={reset}>
                    {t('pagination.startAtFirst')}
                  </Button>
                )}
              </Alert>
            ) : null}
            <h2 ref={resultsRef} tabIndex={-1} className="pf-v6-screen-reader">
              {tCommon('pagination.workspaceResults')}
            </h2>
            {workspaces.isLoading ||
            (isTransitioning && !workspaces.data && !workspaces.isError) ? (
              <Bullseye>
                <Spinner aria-label={t('loading')} />
              </Bullseye>
            ) : (
              <CursorPageTransition
                loading={Boolean(
                  isTransitioning && workspaces.isPlaceholderData,
                )}
                loadingLabel={t('loading')}
              >
                <Table
                  aria-label={t('table.ariaLabel')}
                  data-testid="workspace-table"
                >
                  <Thead>
                    <Tr>
                      {isPlatformAdmin && (
                        <Th
                          select={{
                            onSelect: (_event, isSelecting) =>
                              toggleAll(pageNames, isSelecting),
                            isSelected: pageAllSelected(pageNames),
                          }}
                          aria-label={t('bulkDelete.selectAll')}
                        />
                      )}
                      <Th>{t('table.name')}</Th>
                      <Th>{t('table.phase')}</Th>
                      <Th>{t('table.labels')}</Th>
                      <Th>{t('table.age')}</Th>
                      {isPlatformAdmin && (
                        <Th screenReaderText={t('table.actions')} />
                      )}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((workspace, rowIndex) => (
                      <Tr key={workspace.metadata.name}>
                        {isPlatformAdmin && (
                          <Td
                            select={{
                              rowIndex,
                              onSelect: (_event, isSelecting) =>
                                toggleOne(workspace.metadata.name, isSelecting),
                              isSelected: selected.includes(
                                workspace.metadata.name,
                              ),
                            }}
                          />
                        )}
                        <Td dataLabel={t('table.name')}>
                          <Button
                            variant="link"
                            isInline
                            onClick={() => onSelect?.(workspace.metadata.name)}
                            data-testid={`workspace-link-${workspace.metadata.name}`}
                          >
                            {workspace.metadata.name}
                          </Button>
                        </Td>
                        <Td dataLabel={t('table.phase')}>
                          <PhaseLabel phase={workspace.phase} />
                        </Td>
                        <Td dataLabel={t('table.labels')}>
                          <LabelsList labels={workspace.metadata.labels} />
                        </Td>
                        <Td dataLabel={t('table.age')}>
                          {formatAge(workspace.metadata.createdAtMs)}
                        </Td>
                        {isPlatformAdmin && (
                          <Td isActionCell>
                            <ActionsColumn
                              items={[
                                {
                                  title: t('delete.action'),
                                  onClick: () =>
                                    openDelete([workspace.metadata.name]),
                                },
                              ]}
                            />
                          </Td>
                        )}
                      </Tr>
                    ))}
                    {/* Only a selector that was applied can have matched
                    nothing. */}
                    {rows.length === 0 &&
                      !workspaces.isError &&
                      labelSelector && (
                        <Tr>
                          <Td colSpan={isPlatformAdmin ? 6 : 4}>
                            {t('filter.noMatch')}
                          </Td>
                        </Tr>
                      )}
                  </Tbody>
                </Table>
              </CursorPageTransition>
            )}
            <CursorPagination
              variant="bottom"
              resultsRef={resultsRef}
              {...paginationProps}
            />
          </>
        )}
      </PageSection>
      <CreateWorkspaceModal
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      {/* Keyed by what it is asked about, so that what was typed to confirm
          one delete is never still there for the next. */}
      <ConfirmDeleteModal
        key={targets.join('\n')}
        title={
          isBulk
            ? t('bulkDelete.title', { total: targets.length })
            : t('delete.title')
        }
        body={
          isBulk
            ? t('bulkDelete.body', {
                names: targets.map((name) => `"${name}"`).join(', '),
              })
            : t('delete.body', { name: targets[0] ?? '' })
        }
        confirmName={confirmPhrase}
        isOpen={deleteTargets !== null}
        isDeleting={bulkDelete.isDeleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      />
    </>
  );
};

export default WorkspaceListPage;
