import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
  Pagination,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { useDeleteWorkspace, useWorkspaces } from '../api/workspaces';
import { useAlerts } from '../app/AlertContext';
import { useUserRole } from '../api/rbac';
import CreateWorkspaceModal from '../components/CreateWorkspaceModal';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import { useI18n } from '../i18n';
import { formatAge } from '../utils/formatters';

type WorkspaceListPageProps = {
  onSelect?: (name: string) => void;
  renderWorkspaceHeader?: () => React.ReactNode;
};

const WorkspaceListPage: React.FC<WorkspaceListPageProps> = ({
  onSelect,
  renderWorkspaceHeader,
}) => {
  const { t } = useI18n('workspaces');
  const { t: tCommon } = useI18n('common');
  const workspaces = useWorkspaces();
  const deleteWorkspace = useDeleteWorkspace();
  const { addSuccess } = useAlerts();
  const { isPlatformAdmin } = useUserRole();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  if (workspaces.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label={t('loading')} />
        </Bullseye>
      </PageSection>
    );
  }

  if (workspaces.isError) {
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

  const allRows = workspaces.data ?? [];
  const startIdx = (page - 1) * perPage;
  const rows = allRows.slice(startIdx, startIdx + perPage);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">{t('title')}</Title>
      </PageSection>
      {renderWorkspaceHeader && (
        <PageSection>{renderWorkspaceHeader()}</PageSection>
      )}
      <PageSection>
        {allRows.length === 0 ? (
          <EmptyState
            titleText={t('empty.title')}
            icon={CubesIcon}
            variant="xl"
          >
            <EmptyStateBody>{t('empty.body')}</EmptyStateBody>
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
                <ToolbarItem align={{ default: 'alignEnd' }}>
                  <Pagination
                    itemCount={allRows.length}
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
            <Table
              aria-label={t('table.ariaLabel')}
              data-testid="workspace-table"
            >
              <Thead>
                <Tr>
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
                {rows.map((workspace) => (
                  <Tr key={workspace.metadata.name}>
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
                                setDeleteTarget(workspace.metadata.name),
                            },
                          ]}
                        />
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </>
        )}
      </PageSection>
      <CreateWorkspaceModal
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ConfirmDeleteModal
        title={t('delete.title')}
        body={t('delete.body', { name: deleteTarget ?? '' })}
        confirmName={deleteTarget ?? undefined}
        isOpen={deleteTarget !== null}
        isDeleting={deleteWorkspace.isPending}
        error={
          deleteWorkspace.isError
            ? (deleteWorkspace.error as Error).message
            : undefined
        }
        onConfirm={() => {
          if (deleteTarget) {
            deleteWorkspace.mutate(deleteTarget, {
              onSuccess: () => {
                addSuccess(t('delete.toast', { name: deleteTarget }));
                setDeleteTarget(null);
              },
            });
          }
        }}
        onCancel={() => {
          deleteWorkspace.reset();
          setDeleteTarget(null);
        }}
      />
    </>
  );
};

export default WorkspaceListPage;
