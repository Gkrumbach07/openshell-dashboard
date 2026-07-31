import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  ExpandableSection,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  TextArea,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';

import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  HistoryIcon,
  InProgressIcon,
} from '@patternfly/react-icons';

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
import { formatTimestamp } from './utils';
import type { ApiError } from '../api/client';
import type { NetworkPolicyRule, PolicyChunk } from '../types';

type SandboxDraftsTabProps = {
  workspace: string;
  sandboxName: string;
};

const chunkStatusColor = (status: string): 'green' | 'red' | 'blue' | 'grey' => {
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

const SandboxDraftsTab: React.FC<SandboxDraftsTabProps> = ({ workspace, sandboxName }) => {
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
          Draft policy decisions are attributed to a reviewer, so the gateway requires an
          authenticated principal. Run the gateway with OIDC (and sign in) to use this tab.
        </Alert>
      );
    }
    return (
      <Alert
        variant="danger"
        title="Failed to load draft policy"
        actionLinks={<Button variant="link" onClick={() => drafts.refetch()}>Retry</Button>}
      >
        {(drafts.error as Error).message}
      </Alert>
    );
  }

  const chunks = drafts.data?.chunks ?? [];
  const pending = chunks.filter((chunk) => chunk.status === 'pending');
  const mutationError =
    approve.error || reject.error || approveAll.error || edit.error || undo.error || clear.error;

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

  const renderChunk = (chunk: PolicyChunk) => (
    <StackItem key={chunk.id}>
      <Card data-testid={`draft-chunk-${chunk.id}`}>
        <CardTitle>
          <Label isCompact color={chunkStatusColor(chunk.status)} icon={chunkStatusIcon(chunk.status)}>
            {chunk.status}
          </Label>{' '}
          {chunk.ruleName || chunk.id}
          {chunk.securityNotes && (
            <Label isCompact color="red" className="pf-v6-u-ml-sm">
              security flagged
            </Label>
          )}
        </CardTitle>
        <CardBody>
          <Stack hasGutter>
            {chunk.rationale && (
              <StackItem>
                <Content component="p">{chunk.rationale}</Content>
              </StackItem>
            )}
            {chunk.securityNotes && (
              <StackItem>
                <Alert variant="warning" isInline title="Security notes">
                  {chunk.securityNotes}
                </Alert>
              </StackItem>
            )}
            {chunk.validationResult && (
              <StackItem>
                <Alert variant="info" isInline title="Prover verdict">
                  {chunk.validationResult}
                </Alert>
              </StackItem>
            )}
            {chunk.proposedRule && (
              <StackItem>
                <CodeBlock>
                  <CodeBlockCode>{JSON.stringify(chunk.proposedRule, null, 2)}</CodeBlockCode>
                </CodeBlock>
              </StackItem>
            )}
            <StackItem>
              <Content component="small">
                {chunk.binary && <>binary: {chunk.binary} · </>}
                hits: {chunk.hitCount} · confidence: {chunk.confidence.toFixed(2)} · proposed{' '}
                {formatTimestamp(chunk.createdAtMs)}
                {chunk.rejectionReason && <> · rejected: {chunk.rejectionReason}</>}
              </Content>
            </StackItem>
            {isWorkspaceAdmin && chunk.status === 'pending' && (
              <StackItem>
                {rejecting === chunk.id ? (
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
                ) : (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => approve.mutate(chunk.id)}
                      isDisabled={approve.isPending}
                      data-testid={`approve-chunk-${chunk.id}`}
                    >
                      Approve
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      onClick={() => openEditModal(chunk)}
                      data-testid={`edit-chunk-${chunk.id}`}
                    >
                      Edit
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      onClick={() => setRejecting(chunk.id)}
                      data-testid={`reject-chunk-${chunk.id}`}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </StackItem>
            )}
            {isWorkspaceAdmin && chunk.status === 'approved' && (
              <StackItem>
                <Button
                  variant="warning"
                  onClick={() => undo.mutate(chunk.id)}
                  isDisabled={undo.isPending}
                  isLoading={undo.isPending}
                  data-testid={`undo-chunk-${chunk.id}`}
                >
                  Undo
                </Button>
              </StackItem>
            )}
          </Stack>
        </CardBody>
      </Card>
    </StackItem>
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
            No policy proposals. Proposals appear here when the sandbox observes denied network
            activity (or an in-sandbox agent submits one).
          </Content>
        </StackItem>
      ) : (
        chunks.map(renderChunk)
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
            <DescriptionList isHorizontal isCompact data-testid="draft-history-list">
              {history.data.map((entry, idx) => (
                <DescriptionListGroup key={idx}>
                  <DescriptionListTerm>
                    <Label isCompact icon={<HistoryIcon />}>
                      {entry.eventType}
                    </Label>{' '}
                    {formatTimestamp(entry.timestampMs)}
                  </DescriptionListTerm>
                  <DescriptionListDescription>
                    {entry.description}
                    {entry.chunkId && (
                      <Content component="small" className="pf-v6-u-ml-sm">
                        chunk: {entry.chunkId}
                      </Content>
                    )}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              ))}
            </DescriptionList>
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
          <ModalHeader title={`Edit proposed rule: ${editingChunk.ruleName || editingChunk.id}`} />
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
                  style={{ fontFamily: 'var(--pf-t--global--font--family--mono)' }}
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
