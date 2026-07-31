import { useMemo, useState } from 'react';
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
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  MenuToggle,
  Pagination,
  Spinner,
  Stack,
  StackItem,
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
  SecurityIcon,
  ThIcon,
} from '@patternfly/react-icons';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useNavigate } from 'react-router-dom';

import { useDraftNotifications, useSandboxPolicies } from '../api/policy';
import { deleteSandbox, useSandboxes } from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import CreateSandboxModal from '../components/CreateSandboxModal';
import LabelsList from '../components/LabelsList';
import SandboxGalleryView from '../components/SandboxGalleryView';
import { useBulkDelete } from '../components/useBulkDelete';
import StatusDot from '../components/StatusDot';
import { countEgressHosts, formatAge } from '../components/utils';
import type { Sandbox, SandboxPolicyView } from '../types';

const getStatusText = (sandbox: Sandbox): string => {
  if (sandbox.status.phase === 'READY') return 'Ready';
  if (sandbox.status.phase === 'ERROR') {
    return sandbox.status.conditions?.find((c) => c.reason)?.reason ?? 'Error';
  }
  return sandbox.status.phase;
};

const getPolicyCells = (sandbox: Sandbox, pv?: SandboxPolicyView) => {
  const policy = pv?.latest?.policy ?? sandbox.spec.policy;
  const version = pv?.activeVersion ?? sandbox.status.currentPolicyVersion;
  const np = policy?.networkPolicies ?? {};
  const ruleCount = Object.keys(np).length;
  const hostCount = countEgressHosts(np);
  const latestStatus = pv?.latest?.status;

  let title: string;
  let iconColor: string;
  if (version === 0 || !policy) {
    title = 'Never loaded';
    iconColor = 'var(--pf-t--global--icon--color--status--warning--default)';
  } else if (latestStatus === 'PENDING') {
    title = `v${version} pending`;
    iconColor = 'var(--pf-t--global--icon--color--subtle)';
  } else if (latestStatus === 'FAILED') {
    title = `v${version} failed`;
    iconColor = 'var(--pf-t--global--icon--color--status--danger--default)';
  } else {
    title = `v${version} enforced`;
    iconColor = 'var(--pf-t--global--icon--color--status--success--default)';
  }

  let subtitle = '';
  if (version > 0 && hostCount > 0) {
    subtitle = `${hostCount} host${hostCount > 1 ? 's' : ''} in ${ruleCount} rule${ruleCount > 1 ? 's' : ''}`;
  } else if (version > 0) {
    subtitle = `v${version} defined, no egress`;
  }

  return { title, iconColor, subtitle };
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
};

const SandboxListPage: React.FC<SandboxListPageProps> = ({ workspace, onSelect }) => {
  const navigate = useNavigate();
  const sandboxes = useSandboxes(workspace);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isActionsOpen, setActionsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const visibleNames = useMemo(() => {
    const all = sandboxes.data ?? [];
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage).map((s) => s.metadata.name);
  }, [sandboxes.data, page, perPage]);
  const policyViews = useSandboxPolicies(workspace, visibleNames);
  const drafts = useDraftNotifications();
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
          <ToolbarItem>
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
      {viewMode === 'list' ? (
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
              <Th>Status</Th>
              <Th>Policy</Th>
              <Th>Providers</Th>
              <Th>Labels</Th>
              <Th>Age</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((sandbox, rowIndex) => {
              const pv = policyViews[sandbox.metadata.name];
              const pc = getPolicyCells(sandbox, pv);
              const providers = sandbox.spec.providers ?? [];
              const isReady = sandbox.status.phase === 'READY';
              const imageParts = (sandbox.spec.image || '').split('/');
              const imageShort = imageParts[imageParts.length - 1] || '-';
              return (
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
                    <Stack>
                      <StackItem>
                        <Button
                          variant="link"
                          isInline
                          onClick={() => onSelect?.(sandbox.metadata.name)}
                          data-testid={`sandbox-link-${sandbox.metadata.name}`}
                        >
                          {sandbox.metadata.name}
                        </Button>
                      </StackItem>
                      <StackItem>
                        <Content
                          component="small"
                          style={{ fontFamily: 'var(--pf-t--global--font--family--mono)' }}
                        >
                          {imageShort}
                        </Content>
                      </StackItem>
                    </Stack>
                  </Td>
                  <Td dataLabel="Status">
                    <Flex
                      alignItems={{ default: 'alignItemsCenter' }}
                      gap={{ default: 'gapSm' }}
                      flexWrap={{ default: 'nowrap' }}
                    >
                      <FlexItem>
                        <StatusDot phase={sandbox.status.phase} />
                      </FlexItem>
                      <FlexItem>
                        <span
                          style={{
                            color: sandbox.status.phase === 'ERROR'
                              ? 'var(--pf-t--global--text--color--status--danger--default)'
                              : undefined,
                          }}
                        >
                          {getStatusText(sandbox)}
                        </span>
                      </FlexItem>
                    </Flex>
                  </Td>
                  <Td dataLabel="Policy">
                    <Stack>
                      <StackItem>
                        <Flex
                          alignItems={{ default: 'alignItemsCenter' }}
                          gap={{ default: 'gapSm' }}
                          flexWrap={{ default: 'nowrap' }}
                        >
                          <FlexItem>
                            <SecurityIcon style={{ color: pc.iconColor }} />
                          </FlexItem>
                          <FlexItem>
                            <strong>{pc.title}</strong>
                          </FlexItem>
                        </Flex>
                      </StackItem>
                      {pc.subtitle && (
                        <StackItem>
                          <Content component="small">{pc.subtitle}</Content>
                        </StackItem>
                      )}
                    </Stack>
                  </Td>
                  <Td dataLabel="Providers">
                    {providers.length > 0 ? (
                      <LabelGroup numLabels={2}>
                        {providers.map((p) => (
                          <Label key={p} color="teal" isCompact>
                            {p}
                          </Label>
                        ))}
                      </LabelGroup>
                    ) : (
                      <Content component="small">—</Content>
                    )}
                  </Td>
                  <Td dataLabel="Labels">
                    <LabelsList labels={sandbox.metadata.labels} numLabels={2} />
                  </Td>
                  <Td dataLabel="Age">{formatAge(sandbox.metadata.createdAtMs)}</Td>
                  <Td isActionCell>
                    <ActionsColumn
                      items={[
                        ...(isReady
                          ? [
                              {
                                title: 'Terminal',
                                onClick: () =>
                                  navigate(
                                    `/workspaces/${workspace}/sandboxes/${sandbox.metadata.name}?tab=terminal`,
                                  ),
                              },
                            ]
                          : []),
                        {
                          title: 'Logs',
                          onClick: () =>
                            navigate(
                              `/workspaces/${workspace}/sandboxes/${sandbox.metadata.name}?tab=logs`,
                            ),
                        },
                        {
                          title: 'Delete',
                          onClick: () => setDeleteTargets([sandbox.metadata.name]),
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              );
            })}
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={7}>No sandboxes match this filter.</Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      ) : (
        <SandboxGalleryView
          sandboxes={rows}
          draftSummaries={drafts.items.filter((d) => d.workspace === workspace)}
          policyViews={policyViews}
          onDelete={(name) => setDeleteTargets([name])}
          onSelect={onSelect}
          onViewLogs={(name) => navigate(`/workspaces/${workspace}/sandboxes/${name}?tab=logs`)}
          onOpenTerminal={(name) => navigate(`/workspaces/${workspace}/sandboxes/${name}?tab=terminal`)}
          onReviewDrafts={(name) => navigate(`/workspaces/${workspace}/sandboxes/${name}?tab=proposals`)}
          onCreateClick={() => setCreateOpen(true)}
        />
      )}
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
