import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  Content,
  Spinner,
  Stack,
  StackItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Th, Thead, Tr } from '@patternfly/react-table';

import { useDraftPolicy } from '../../api/policy';
import { useWorkspaceRole } from '../../api/rbac';
import DraftChunkRow from './DraftChunkRow';
import DraftHistorySection from './DraftHistorySection';
import EditDraftModal from './EditDraftModal';
import { useDraftActions } from './useDraftActions';
import type { ApiError } from '../../api/client';
import type { PolicyChunk } from '../../types';

type SandboxDraftsTabProps = {
  workspace: string;
  sandboxName: string;
};

const SandboxDraftsTab: React.FC<SandboxDraftsTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const drafts = useDraftPolicy(workspace, sandboxName);
  const actions = useDraftActions(workspace, sandboxName);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [editingChunk, setEditingChunk] = useState<PolicyChunk | null>(null);
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

  return (
    <Stack hasGutter>
      {drafts.data?.rollingSummary && (
        <StackItem>
          <Alert variant="info" isInline title="Analysis summary">
            {drafts.data.rollingSummary}
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
      <StackItem>
        {isWorkspaceAdmin && (
          <Toolbar aria-label="Draft actions">
            <ToolbarContent>
              <ToolbarItem>
                <Button
                  onClick={() => actions.approveAll.mutate(includeFlagged)}
                  isDisabled={
                    pending.length === 0 || actions.approveAll.isPending
                  }
                  isLoading={actions.approveAll.isPending}
                  data-testid="approve-all-chunks"
                >
                  Approve all pending ({pending.length})
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  onClick={() => actions.clear.mutate(undefined)}
                  isDisabled={pending.length === 0 || actions.clear.isPending}
                  isLoading={actions.clear.isPending}
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
            {chunks.map((chunk, rowIndex) => (
              <DraftChunkRow
                key={chunk.id}
                chunk={chunk}
                rowIndex={rowIndex}
                isOpen={expanded.has(chunk.id)}
                isWorkspaceAdmin={isWorkspaceAdmin}
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
        onClose={() => setEditingChunk(null)}
        onSave={(chunkId, proposedRule) =>
          actions.edit.mutate(
            { chunkId, proposedRule },
            { onSuccess: () => setEditingChunk(null) },
          )
        }
        isPending={actions.edit.isPending}
      />
    </Stack>
  );
};

export default SandboxDraftsTab;
