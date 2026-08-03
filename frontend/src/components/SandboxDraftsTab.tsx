import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  Content,
  ExpandableSection,
  Flex,
  FlexItem,
  Label,
  Modal,
  ModalBody,
  Popover,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  TextArea,
  Timestamp,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';

import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InProgressIcon,
} from '@patternfly/react-icons';

import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import {
  useApproveAllDraftChunks,
  useApproveDraftChunk,
  useClearDraftChunks,
  useDraftHistory,
  useDraftPolicy,
  useEditDraftChunk,
  useRejectDraftChunk,
  useUndoDraftChunk,
} from '../api/policy';
import { useWorkspaceRole } from '../app/useWorkspaceRole';

import type { ApiError } from '../api/client';
import type { NetworkPolicyRule, PolicyChunk } from '../types';

type SandboxDraftsTabProps = {
  workspace: string;
  sandboxName: string;
};

const eventColor = (
  eventType: string,
): 'green' | 'red' | 'blue' | 'orange' | 'grey' => {
  const lower = eventType.toLowerCase();
  if (lower.includes('approved') || lower.includes('approve')) return 'green';
  if (
    lower.includes('rejected') ||
    lower.includes('reject') ||
    lower.includes('cleared')
  )
    return 'red';
  if (lower.includes('proposed') || lower.includes('submit')) return 'blue';
  if (lower.includes('undo')) return 'orange';
  return 'grey';
};

const chunkStatusColor = (
  status: string,
): 'green' | 'red' | 'blue' | 'grey' => {
  switch (status) {
    case 'approved':
      return 'green';
    case 'rejected':
      return 'red';
    case 'pending':
      return 'blue';
    default:
      return 'grey';
  }
};

const chunkStatusIcon = (status: string) => {
  switch (status) {
    case 'approved':
      return <CheckCircleIcon />;
    case 'rejected':
      return <ExclamationCircleIcon />;
    case 'pending':
      return <InProgressIcon />;
    default:
      return undefined;
  }
};

const SandboxDraftsTab: React.FC<SandboxDraftsTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const drafts = useDraftPolicy(workspace, sandboxName);
  const approve = useApproveDraftChunk(workspace, sandboxName);
  const reject = useRejectDraftChunk(workspace, sandboxName);
  const approveAll = useApproveAllDraftChunks(workspace, sandboxName);
  const edit = useEditDraftChunk(workspace, sandboxName);
  const undo = useUndoDraftChunk(workspace, sandboxName);
  const clear = useClearDraftChunks(workspace, sandboxName);
  const history = useDraftHistory(workspace, sandboxName);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [editingChunk, setEditingChunk] = useState<PolicyChunk | null>(null);
  const [editJson, setEditJson] = useState('');
  const [editJsonError, setEditJsonError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  if (drafts.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading draft policy" />
      </Bullseye>
    );
  }

  if (drafts.isError) {
    if ((drafts.error as ApiError).status === 401) {
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
          <Button variant="link" onClick={() => drafts.refetch()}>
            Retry
          </Button>
        }
      >
        {(drafts.error as Error).message}
      </Alert>
    );
  }

  const chunks = drafts.data?.chunks ?? [];
  const pending = chunks.filter((chunk) => chunk.status === 'pending');
  const mutationError =
    approve.error ||
    reject.error ||
    approveAll.error ||
    edit.error ||
    undo.error ||
    clear.error;

  const openEditModal = (chunk: PolicyChunk) => {
    setEditingChunk(chunk);
    setEditJson(JSON.stringify(chunk.proposedRule ?? {}, null, 2));
    setEditJsonError('');
  };

  const handleEditSave = () => {
    if (!editingChunk) return;
    let parsed: NetworkPolicyRule;
    try {
      parsed = JSON.parse(editJson) as NetworkPolicyRule;
    } catch {
      setEditJsonError('Invalid JSON');
      return;
    }
    edit.mutate(
      { chunkId: editingChunk.id, proposedRule: parsed },
      { onSuccess: () => setEditingChunk(null) },
    );
  };

  const renderExpandedContent = (chunk: PolicyChunk) => (
    <Stack hasGutter>
      {isWorkspaceAdmin &&
        chunk.status === 'pending' &&
        rejecting === chunk.id && (
          <StackItem>
            <Stack hasGutter>
              <StackItem>
                <TextArea
                  aria-label="Rejection reason"
                  data-testid="reject-reason-input"
                  value={rejectReason}
                  onChange={(_event, value) => setRejectReason(value)}
                  placeholder="Optional reason — fed back to the in-sandbox agent"
                  rows={2}
                />
              </StackItem>
              <StackItem>
                <Button
                  variant="danger"
                  onClick={() =>
                    reject.mutate(
                      { chunkId: chunk.id, reason: rejectReason || undefined },
                      {
                        onSuccess: () => {
                          setRejecting(null);
                          setRejectReason('');
                        },
                      },
                    )
                  }
                  isLoading={reject.isPending}
                  data-testid="confirm-reject-chunk"
                >
                  Confirm reject
                </Button>{' '}
                <Button variant="link" onClick={() => setRejecting(null)}>
                  Cancel
                </Button>
              </StackItem>
            </Stack>
          </StackItem>
        )}
      {chunk.securityNotes && (
        <StackItem>
          <Alert variant="warning" isInline title="Security notes">
            {chunk.securityNotes}
          </Alert>
        </StackItem>
      )}
      {chunk.proposedRule && (
        <StackItem>
          <CodeBlock>
            <CodeBlockCode>
              {JSON.stringify(chunk.proposedRule, null, 2)}
            </CodeBlockCode>
          </CodeBlock>
        </StackItem>
      )}
      <StackItem>
        <Content component="small">
          {chunk.binary && <>binary: {chunk.binary} · </>}
          hits: {chunk.hitCount}
          {chunk.validationResult && <> · prover: {chunk.validationResult}</>}
          {chunk.rejectionReason && <> · rejected: {chunk.rejectionReason}</>}
        </Content>
      </StackItem>
    </Stack>
  );

  return (
    <Stack hasGutter>
      {drafts.data?.rollingSummary && (
        <StackItem>
          <Alert variant="info" isInline title="Analysis summary">
            {drafts.data.rollingSummary}
          </Alert>
        </StackItem>
      )}
      {mutationError && (
        <StackItem>
          <Alert variant="danger" isInline title="Draft action failed">
            {(mutationError as Error).message}
          </Alert>
        </StackItem>
      )}
      <StackItem>
        {isWorkspaceAdmin && (
          <Toolbar aria-label="Draft actions">
            <ToolbarContent>
              <ToolbarItem>
                <Button
                  onClick={() => approveAll.mutate(includeFlagged)}
                  isDisabled={pending.length === 0 || approveAll.isPending}
                  isLoading={approveAll.isPending}
                  data-testid="approve-all-chunks"
                >
                  Approve all pending ({pending.length})
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  onClick={() => clear.mutate(undefined)}
                  isDisabled={pending.length === 0 || clear.isPending}
                  isLoading={clear.isPending}
                  data-testid="clear-all-chunks"
                >
                  Clear all pending
                </Button>
              </ToolbarItem>
              <ToolbarItem alignSelf="center">
                <Checkbox
                  id="include-security-flagged"
                  data-testid="include-security-flagged"
                  label="Include security-flagged proposals"
                  isChecked={includeFlagged}
                  onChange={(_event, checked) => setIncludeFlagged(checked)}
                />
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        )}
      </StackItem>
      {chunks.length === 0 ? (
        <StackItem>
          <Content component="p">
            No policy proposals. Proposals appear here when the sandbox observes
            denied network activity (or an in-sandbox agent submits one).
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
                <Th>Proposed</Th>
                {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            {chunks.map((chunk, rowIndex) => {
              const isOpen = expanded.has(chunk.id);
              return (
                <Tbody key={chunk.id} isExpanded={isOpen}>
                  <Tr data-testid={`draft-chunk-${chunk.id}`}>
                    <Td
                      expand={{
                        rowIndex,
                        isExpanded: isOpen,
                        onToggle: () => toggleExpand(chunk.id),
                      }}
                    />
                    <Td dataLabel="Rule">
                      <Stack>
                        <StackItem>
                          {chunk.ruleName || chunk.id}
                          {chunk.securityNotes && (
                            <Label
                              isCompact
                              color="red"
                              className="pf-v6-u-ml-sm"
                            >
                              flagged
                            </Label>
                          )}
                        </StackItem>
                        {chunk.rationale && (
                          <StackItem>
                            <Content component="small">
                              {chunk.rationale}
                            </Content>
                          </StackItem>
                        )}
                      </Stack>
                    </Td>
                    <Td dataLabel="Status">
                      {chunk.status === 'rejected' && chunk.rejectionReason ? (
                        <Popover
                          headerContent="Rejection reason"
                          bodyContent={chunk.rejectionReason}
                        >
                          <Label
                            isCompact
                            color={chunkStatusColor(chunk.status)}
                            icon={chunkStatusIcon(chunk.status)}
                            style={{ cursor: 'pointer' }}
                          >
                            {chunk.status}
                          </Label>
                        </Popover>
                      ) : (
                        <Label
                          isCompact
                          color={chunkStatusColor(chunk.status)}
                          icon={chunkStatusIcon(chunk.status)}
                        >
                          {chunk.status}
                        </Label>
                      )}
                    </Td>
                    <Td dataLabel="Confidence">
                      {chunk.confidence.toFixed(2)}
                    </Td>
                    <Td dataLabel="Proposed">
                      <Timestamp date={new Date(chunk.createdAtMs)} />
                    </Td>
                    {isWorkspaceAdmin && (
                      <Td isActionCell>
                        <Flex
                          flexWrap={{ default: 'nowrap' }}
                          gap={{ default: 'gapSm' }}
                        >
                          {chunk.status === 'pending' && (
                            <>
                              <FlexItem>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => approve.mutate(chunk.id)}
                                  isDisabled={approve.isPending}
                                  data-testid={`approve-chunk-${chunk.id}`}
                                >
                                  Approve
                                </Button>
                              </FlexItem>
                              <FlexItem>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => openEditModal(chunk)}
                                  data-testid={`edit-chunk-${chunk.id}`}
                                >
                                  Edit
                                </Button>
                              </FlexItem>
                              <FlexItem>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    setRejecting(chunk.id);
                                    if (!isOpen) toggleExpand(chunk.id);
                                  }}
                                  data-testid={`reject-chunk-${chunk.id}`}
                                >
                                  Reject
                                </Button>
                              </FlexItem>
                            </>
                          )}
                          {chunk.status === 'approved' && (
                            <FlexItem>
                              <Button
                                variant="warning"
                                size="sm"
                                onClick={() => undo.mutate(chunk.id)}
                                isDisabled={undo.isPending}
                                isLoading={undo.isPending}
                                data-testid={`undo-chunk-${chunk.id}`}
                              >
                                Undo
                              </Button>
                            </FlexItem>
                          )}
                        </Flex>
                      </Td>
                    )}
                  </Tr>
                  <Tr isExpanded={isOpen}>
                    <Td dataLabel="Details" colSpan={isWorkspaceAdmin ? 6 : 5}>
                      <ExpandableRowContent>
                        {renderExpandedContent(chunk)}
                      </ExpandableRowContent>
                    </Td>
                  </Tr>
                </Tbody>
              );
            })}
          </Table>
        </StackItem>
      )}

      <StackItem>
        <ExpandableSection
          toggleText={historyOpen ? 'Hide history' : 'Show history'}
          onToggle={(_event, expanded) => setHistoryOpen(expanded)}
          isExpanded={historyOpen}
          data-testid="draft-history-toggle"
        >
          {history.isLoading && (
            <Bullseye>
              <Spinner size="md" aria-label="Loading history" />
            </Bullseye>
          )}
          {history.isError && (
            <Alert variant="danger" isInline title="Failed to load history">
              {(history.error as Error).message}
            </Alert>
          )}
          {history.data && history.data.length === 0 && (
            <Content component="p">No draft history entries yet.</Content>
          )}
          {history.data && history.data.length > 0 && (
            <Table
              aria-label="Draft history"
              variant="compact"
              data-testid="draft-history-list"
            >
              <Thead>
                <Tr>
                  <Th>Event</Th>
                  <Th>Description</Th>
                  <Th>Time</Th>
                </Tr>
              </Thead>
              <Tbody>
                {history.data.map((entry, idx) => (
                  <Tr key={idx}>
                    <Td dataLabel="Event">
                      <Label isCompact color={eventColor(entry.eventType)}>
                        {entry.eventType}
                      </Label>
                    </Td>
                    <Td dataLabel="Description">{entry.description}</Td>
                    <Td dataLabel="Time">
                      <Timestamp date={new Date(entry.timestampMs)} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </ExpandableSection>
      </StackItem>

      {editingChunk && (
        <Modal
          isOpen
          onClose={() => setEditingChunk(null)}
          aria-label="Edit draft chunk"
          variant="medium"
          data-testid="edit-chunk-modal"
        >
          <ModalHeader
            title={`Edit proposed rule: ${editingChunk.ruleName || editingChunk.id}`}
          />
          <ModalBody>
            <Stack hasGutter>
              {editJsonError && (
                <StackItem>
                  <Alert variant="danger" isInline title={editJsonError} />
                </StackItem>
              )}
              <StackItem>
                <TextArea
                  aria-label="Proposed rule JSON"
                  data-testid="edit-chunk-json"
                  value={editJson}
                  onChange={(_event, value) => {
                    setEditJson(value);
                    setEditJsonError('');
                  }}
                  rows={16}
                  style={{
                    fontFamily: 'var(--pf-t--global--font--family--mono)',
                  }}
                />
              </StackItem>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="primary"
              onClick={handleEditSave}
              isLoading={edit.isPending}
              isDisabled={edit.isPending}
              data-testid="save-edit-chunk"
            >
              Save
            </Button>
            <Button variant="link" onClick={() => setEditingChunk(null)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Stack>
  );
};

export default SandboxDraftsTab;
