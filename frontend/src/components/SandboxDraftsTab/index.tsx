import { useState } from 'react';
import {
  Alert,
  AlertActionCloseButton,
  Bullseye,
  Button,
  Checkbox,
  Content,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  MenuToggle,
  Panel,
  PanelMain,
  PanelMainBody,
  Popover,
  Spinner,
  Stack,
  StackItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { InfoCircleIcon } from '@patternfly/react-icons';
import { Table, Th, Thead, Tr } from '@patternfly/react-table';

import { useDraftPolicy, useEffectiveSandboxPolicy } from '../../api/policy';
import { useWorkspaceRole } from '../../api/rbac';
import { useI18n } from '../../i18n';
import { formatTimestamp } from '../../utils/formatters';
import RefreshErrorAlert, { isRefreshError } from '../RefreshErrorAlert';
import DraftChunkRow from './DraftChunkRow';
import DraftHistorySection from './DraftHistorySection';
import EditDraftModal from './EditDraftModal';
import { useDraftActions } from './useDraftActions';
import { CHUNK_STATUS_FILTERS, pendingApprovals } from './utils';
import type { ApiError } from '../../api/client';
import type { ApproveAllResult, PolicyChunk } from '../../types';

type SandboxDraftsTabProps = {
  workspace: string;
  sandboxName: string;
};

const SandboxDraftsTab: React.FC<SandboxDraftsTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const { t } = useI18n('sandboxes');
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const [statusFilter, setStatusFilter] = useState('');
  const [isStatusOpen, setStatusOpen] = useState(false);
  // The whole inbox drives the pending count and the bulk approval whatever
  // the table is narrowed to; the table reads the gateway's filtered answer.
  const inbox = useDraftPolicy(workspace, sandboxName);
  const filtered = useDraftPolicy(workspace, sandboxName, statusFilter);
  const drafts = statusFilter ? filtered : inbox;
  // While a gateway-global policy is in force the gateway refuses whatever
  // would change the sandbox's own policy: approving a proposal ("cannot
  // approve rules while a global policy is active") and rejecting one that
  // was approved, which takes its rule out again. Neither is offered then.
  const effective = useEffectiveSandboxPolicy(workspace, sandboxName);
  const isGlobalPolicy = effective.data?.policySource === 'GLOBAL';
  const actions = useDraftActions(workspace, sandboxName);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [editingChunk, setEditingChunk] = useState<PolicyChunk | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<ApproveAllResult | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (rejecting === id) {
          setRejecting(null);
          setRejectReason('');
        }
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (inbox.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading draft policy" />
      </Bullseye>
    );
  }

  // The inbox is re-read every few seconds. A refresh that fails leaves the
  // proposals, and a rule being edited or a reason being typed, as they
  // were, with a note above; only an inbox that never loaded is replaced by
  // the error.
  const inboxRefreshFailed = isRefreshError(inbox);
  const filterRefreshFailed = isRefreshError(drafts);
  const refreshError = inboxRefreshFailed ? inbox : drafts;
  if (inbox.isError && !inboxRefreshFailed) {
    if ((inbox.error as ApiError).status === 401) {
      return (
        <Alert variant="info" title="Sign-in required for policy proposals">
          Draft policy decisions are attributed to a reviewer, so the gateway
          requires an authenticated principal. Run the gateway with OIDC (and
          sign in) to use this tab.
        </Alert>
      );
    }
    return (
      <Alert
        variant="danger"
        title="Failed to load draft policy"
        actionLinks={
          <Button variant="link" onClick={() => inbox.refetch()}>
            Retry
          </Button>
        }
      >
        {(inbox.error as Error).message}
      </Alert>
    );
  }

  const chunks = drafts.data?.chunks ?? [];
  const approvals = pendingApprovals(inbox.data?.chunks ?? []);
  const columns = isWorkspaceAdmin ? 7 : 6;
  // What the toggle says while it is shut, which is the one of the four the
  // gateway is being asked for.
  const statusLabel = t(
    CHUNK_STATUS_FILTERS.find((filter) => filter.value === statusFilter)
      ?.labelKey ?? 'drafts.status.all',
  );

  // Where the draft stands and when the analysis behind it finished. It
  // comes back in the same read as the summary, and it is what says as of
  // when the summary is true, so it goes inside the panel with it. The
  // gateway writes no summary in mechanistic mode, and then this is all
  // there is to say, on its own line above the proposals.
  const analysedAt = (
    <Content component="small" data-testid="draft-version">
      Draft version {inbox.data?.draftVersion ?? 0}
      {inbox.data?.lastAnalyzedAtMs
        ? ` · last analyzed ${formatTimestamp(inbox.data.lastAnalyzedAtMs)}`
        : ''}
    </Content>
  );

  return (
    <Stack hasGutter>
      {(inboxRefreshFailed || filterRefreshFailed) && (
        <StackItem>
          <RefreshErrorAlert
            title="The proposals could not be refreshed"
            error={refreshError.error}
            onRetry={() => refreshError.refetch()}
            data-testid="drafts-refresh-error"
          />
        </StackItem>
      )}
      {isGlobalPolicy && isWorkspaceAdmin && (
        <StackItem>
          <Alert
            variant="warning"
            isInline
            title="Proposals cannot be approved while a gateway-global policy is in force"
            data-testid="drafts-global-policy"
          >
            This sandbox is given the gateway-global policy
            {effective.data?.globalPolicyVersion
              ? ` (revision ${effective.data.globalPolicyVersion})`
              : ''}
            , not its own, and the gateway refuses to approve a proposal, or to
            reject one that was approved, until the global policy is deleted.
            Proposals can still be read, edited and rejected.
          </Alert>
        </StackItem>
      )}
      {actions.mutationError && (
        <StackItem>
          <Alert variant="danger" isInline title="Draft action failed">
            {(actions.mutationError as Error).message}
          </Alert>
        </StackItem>
      )}
      {bulkResult && (
        <StackItem>
          <Alert
            variant={bulkResult.chunksSkipped > 0 ? 'warning' : 'success'}
            isInline
            title={`${bulkResult.chunksApproved} approved, ${bulkResult.chunksSkipped} skipped`}
            data-testid="approve-all-result"
            actionClose={
              <AlertActionCloseButton onClose={() => setBulkResult(null)} />
            }
          >
            {bulkResult.chunksApproved > 0 &&
              `The sandbox's policy is now revision ${bulkResult.policyVersion ?? '-'}. `}
            {bulkResult.chunksSkipped > 0 &&
              'A proposal is skipped when it is security-flagged and those were not included, when it changed since it was shown here, or when it conflicts with one approved before it in the same batch. Skipped proposals stay pending.'}
          </Alert>
        </StackItem>
      )}
      {/* What the analysis has made of this sandbox so far, in the words of
          the model that wrote it (`rolling_summary`: "LLM-generated summary
          of all analysis"). Not an alert: the others in this tab are each
          something that happened and may need acting on, and this is neither
          — it is the standing context the proposals are read in. A raised
          panel sets it off as its own block without colouring it as a
          condition, and the popover says whose words they are. */}
      {inbox.data?.rollingSummary && (
        // More than the stack's own gutter beneath it: what follows is the
        // proposals and the actions on them, and the summary is the context
        // they are read in rather than the first of them.
        <StackItem className="pf-v6-u-mb-md">
          <Panel variant="raised" data-testid="draft-summary">
            <PanelMain>
              <PanelMainBody>
                <Flex
                  gap={{ default: 'gapSm' }}
                  alignItems={{ default: 'alignItemsFlexStart' }}
                  flexWrap={{ default: 'nowrap' }}
                >
                  <FlexItem flex={{ default: 'flex_1' }}>
                    <Content component="p" className="pf-v6-u-mb-sm">
                      {inbox.data.rollingSummary}
                    </Content>
                    {analysedAt}
                  </FlexItem>
                  {/* Whose words these are is asked once and not wanted on
                      screen after that, so the question sits out of the way
                      of them, in the corner of the panel. */}
                  <FlexItem>
                    <Popover bodyContent={t('drafts.summary.source')}>
                      <Button
                        variant="plain"
                        isInline
                        aria-label={t('drafts.summary.sourceAriaLabel')}
                        data-testid="draft-summary-help"
                        // Plain rather than status-coloured: PatternFly's info
                        // status is purple, which on a panel that reports no
                        // condition would read as one.
                        icon={<InfoCircleIcon />}
                      />
                    </Popover>
                  </FlexItem>
                </Flex>
              </PanelMainBody>
            </PanelMain>
          </Panel>
        </StackItem>
      )}
      <StackItem>
        <Toolbar aria-label="Draft actions">
          <ToolbarContent>
            <ToolbarItem>
              <Dropdown
                isOpen={isStatusOpen}
                onOpenChange={setStatusOpen}
                onSelect={(_event, value) => {
                  setStatusFilter(value as string);
                  setStatusOpen(false);
                }}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    isExpanded={isStatusOpen}
                    onClick={() => setStatusOpen(!isStatusOpen)}
                    aria-label={t('drafts.status.label')}
                    data-testid="draft-status-toggle"
                  >
                    {statusLabel}
                  </MenuToggle>
                )}
              >
                <DropdownList>
                  {CHUNK_STATUS_FILTERS.map((filter) => (
                    <DropdownItem
                      key={filter.value || 'all'}
                      value={filter.value}
                      isSelected={statusFilter === filter.value}
                      data-testid={`draft-status-${filter.value || 'all'}`}
                    >
                      {t(filter.labelKey)}
                    </DropdownItem>
                  ))}
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
            {isWorkspaceAdmin && (
              <>
                {!isGlobalPolicy && (
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        actions.approveAll.mutate(
                          { includeSecurityFlagged: includeFlagged, approvals },
                          { onSuccess: (result) => setBulkResult(result) },
                        )
                      }
                      isDisabled={
                        approvals.length === 0 || actions.approveAll.isPending
                      }
                      isLoading={actions.approveAll.isPending}
                      data-testid="approve-all-chunks"
                    >
                      Approve all pending ({approvals.length})
                    </Button>
                  </ToolbarItem>
                )}
                <ToolbarItem>
                  <Button
                    variant="secondary"
                    onClick={() => actions.clear.mutate(undefined)}
                    isDisabled={
                      approvals.length === 0 || actions.clear.isPending
                    }
                    isLoading={actions.clear.isPending}
                    data-testid="clear-all-chunks"
                  >
                    Clear all pending
                  </Button>
                </ToolbarItem>
                {!isGlobalPolicy && (
                  <ToolbarItem alignSelf="center">
                    <Checkbox
                      id="include-security-flagged"
                      data-testid="include-security-flagged"
                      label="Include security-flagged proposals"
                      isChecked={includeFlagged}
                      onChange={(_event, checked) => setIncludeFlagged(checked)}
                    />
                  </ToolbarItem>
                )}
              </>
            )}
          </ToolbarContent>
        </Toolbar>
        {!inbox.data?.rollingSummary && analysedAt}
      </StackItem>
      {drafts.isError && !filterRefreshFailed && (
        <StackItem>
          <Alert variant="danger" isInline title="Failed to load proposals">
            {(drafts.error as Error).message}
          </Alert>
        </StackItem>
      )}
      {chunks.length === 0 ? (
        <StackItem>
          <Content component="p" data-testid="draft-empty">
            {statusFilter
              ? `No ${statusFilter} proposals.`
              : 'No policy proposals. Proposals appear here when the sandbox observes denied network activity (or an in-sandbox agent submits one).'}
          </Content>
        </StackItem>
      ) : (
        <StackItem>
          <Table
            aria-label="Policy proposals"
            variant="compact"
            data-testid="draft-chunks-table"
          >
            <Thead>
              <Tr>
                <Th screenReaderText="Expand" />
                <Th>Rule</Th>
                <Th>Status</Th>
                <Th>Confidence</Th>
                <Th>Denied</Th>
                <Th>Proposed</Th>
                {columns === 7 && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            {chunks.map((chunk, rowIndex) => (
              <DraftChunkRow
                key={chunk.id}
                chunk={chunk}
                rowIndex={rowIndex}
                isOpen={expanded.has(chunk.id)}
                isWorkspaceAdmin={isWorkspaceAdmin}
                isGlobalPolicy={isGlobalPolicy}
                onToggle={() => toggleExpand(chunk.id)}
                onEdit={setEditingChunk}
                actions={actions}
                rejecting={rejecting}
                rejectReason={rejectReason}
                onSetRejecting={setRejecting}
                onSetRejectReason={setRejectReason}
              />
            ))}
          </Table>
        </StackItem>
      )}

      <StackItem>
        <DraftHistorySection workspace={workspace} sandboxName={sandboxName} />
      </StackItem>

      <EditDraftModal
        chunk={editingChunk}
        onClose={() => {
          actions.edit.reset();
          setEditingChunk(null);
        }}
        onSave={(chunkId, proposedRule) =>
          actions.edit.mutate(
            { chunkId, proposedRule },
            { onSuccess: () => setEditingChunk(null) },
          )
        }
        isPending={actions.edit.isPending}
        error={
          actions.edit.isError
            ? (actions.edit.error as Error).message
            : undefined
        }
      />
    </Stack>
  );
};

export default SandboxDraftsTab;
