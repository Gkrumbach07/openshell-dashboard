import React from 'react';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockCode,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  Popover,
  Stack,
  StackItem,
  TextArea,
  Timestamp,
} from '@patternfly/react-core';
import { ExpandableRowContent, Tbody, Td, Tr } from '@patternfly/react-table';

import { formatTimestamp } from '../../utils/formatters';
import { approvalAnnotation, chunkStatusColor, chunkStatusIcon } from './utils';
import type { useDraftActions } from './useDraftActions';
import type { PolicyChunk } from '../../types';

type DraftChunkRowProps = {
  chunk: PolicyChunk;
  rowIndex: number;
  isOpen: boolean;
  isWorkspaceAdmin: boolean;
  // A gateway-global policy is in force on the sandbox. The gateway then
  // refuses the decisions that would change the sandbox's own policy.
  isGlobalPolicy?: boolean;
  onToggle: () => void;
  onEdit: (chunk: PolicyChunk) => void;
  actions: ReturnType<typeof useDraftActions>;
  rejecting: string | null;
  rejectReason: string;
  onSetRejecting: (id: string | null) => void;
  onSetRejectReason: (reason: string) => void;
};

const DraftChunkRow: React.FC<DraftChunkRowProps> = ({
  chunk,
  rowIndex,
  isOpen,
  isWorkspaceAdmin,
  isGlobalPolicy = false,
  onToggle,
  onEdit,
  actions,
  rejecting,
  rejectReason,
  onSetRejecting,
  onSetRejectReason,
}) => {
  const { approve, reject, undo } = actions;
  const annotation = approvalAnnotation(chunk);
  // The gateway takes an approval for a pending or a rejected chunk, and a
  // rejection for a pending or an approved one. Under a gateway-global policy
  // it takes no approval at all, and no rejection of an approved chunk, whose
  // rule the rejection would take out of the sandbox's policy.
  const canApprove =
    !isGlobalPolicy &&
    (chunk.status === 'pending' || chunk.status === 'rejected');
  const canReject =
    chunk.status === 'pending' ||
    (chunk.status === 'approved' && !isGlobalPolicy);

  const startRejecting = () => {
    onSetRejecting(chunk.id);
    if (!isOpen) onToggle();
  };

  return (
    <Tbody isExpanded={isOpen}>
      <Tr data-testid={`draft-chunk-${chunk.id}`}>
        <Td
          expand={{
            rowIndex,
            isExpanded: isOpen,
            onToggle,
          }}
        />
        <Td dataLabel="Rule">
          <Stack>
            <StackItem>
              {chunk.ruleName || chunk.id}
              {chunk.securityNotes && (
                <Label isCompact color="red" className="pf-v6-u-ml-sm">
                  flagged
                </Label>
              )}
              {annotation && (
                <Label
                  isCompact
                  color={annotation.color}
                  className="pf-v6-u-ml-sm"
                  data-testid={`chunk-annotation-${chunk.id}`}
                >
                  {annotation.label}
                </Label>
              )}
              {chunk.stage && (
                <Label isCompact className="pf-v6-u-ml-sm">
                  {chunk.stage}
                </Label>
              )}
            </StackItem>
            {chunk.rationale && (
              <StackItem>
                <Content component="small">{chunk.rationale}</Content>
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
              <Button
                variant="plain"
                isInline
                aria-label={`Rejection reason for ${chunk.ruleName || chunk.id}`}
              >
                <Label
                  isCompact
                  color={chunkStatusColor(chunk.status)}
                  icon={chunkStatusIcon(chunk.status)}
                >
                  {chunk.status}
                </Label>
              </Button>
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
        <Td dataLabel="Confidence">{chunk.confidence.toFixed(2)}</Td>
        <Td dataLabel="Denied">
          {chunk.hitCount} {chunk.hitCount === 1 ? 'time' : 'times'}
        </Td>
        <Td dataLabel="Proposed">
          <Timestamp date={new Date(chunk.createdAtMs)} />
        </Td>
        {isWorkspaceAdmin && (
          <Td isActionCell>
            <Flex flexWrap={{ default: 'nowrap' }} gap={{ default: 'gapSm' }}>
              {canApprove && (
                <FlexItem>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      approve.mutate({
                        chunkId: chunk.id,
                        reviewToken: chunk.reviewToken,
                      })
                    }
                    isDisabled={approve.isPending}
                    data-testid={`approve-chunk-${chunk.id}`}
                  >
                    Approve
                  </Button>
                </FlexItem>
              )}
              {chunk.status === 'pending' && (
                <FlexItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(chunk)}
                    data-testid={`edit-chunk-${chunk.id}`}
                  >
                    Edit
                  </Button>
                </FlexItem>
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
              {canReject && (
                <FlexItem>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={startRejecting}
                    data-testid={`reject-chunk-${chunk.id}`}
                  >
                    Reject
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </Td>
        )}
      </Tr>
      <Tr isExpanded={isOpen}>
        <Td dataLabel="Details" colSpan={isWorkspaceAdmin ? 7 : 6}>
          <ExpandableRowContent>
            <Stack hasGutter>
              {isWorkspaceAdmin && canReject && rejecting === chunk.id && (
                <StackItem>
                  <Stack hasGutter>
                    {chunk.status === 'approved' && (
                      <StackItem>
                        <Content component="small">
                          Rejecting an approved proposal removes its rule from
                          the sandbox&apos;s policy, like Undo, and records the
                          reason.
                        </Content>
                      </StackItem>
                    )}
                    <StackItem>
                      <TextArea
                        aria-label="Rejection reason"
                        data-testid="reject-reason-input"
                        value={rejectReason}
                        onChange={(_event, value) => onSetRejectReason(value)}
                        placeholder="Optional reason — fed back to the in-sandbox agent"
                        rows={2}
                      />
                    </StackItem>
                    <StackItem>
                      <Button
                        variant="danger"
                        onClick={() =>
                          reject.mutate(
                            {
                              chunkId: chunk.id,
                              reason: rejectReason || undefined,
                            },
                            {
                              onSuccess: () => {
                                onSetRejecting(null);
                                onSetRejectReason('');
                              },
                            },
                          )
                        }
                        isLoading={reject.isPending}
                        isDisabled={reject.isPending}
                        data-testid="confirm-reject-chunk"
                      >
                        Confirm reject
                      </Button>{' '}
                      <Button
                        variant="link"
                        onClick={() => onSetRejecting(null)}
                      >
                        Cancel
                      </Button>
                    </StackItem>
                  </Stack>
                </StackItem>
              )}
              {chunk.applicationError && (
                <StackItem>
                  <Alert
                    variant="danger"
                    isInline
                    title="This proposal cannot be applied"
                  >
                    {chunk.applicationError}
                  </Alert>
                </StackItem>
              )}
              {chunk.securityNotes && (
                <StackItem>
                  <Alert variant="warning" isInline title="Security notes">
                    {chunk.securityNotes}
                  </Alert>
                </StackItem>
              )}
              <StackItem>
                <DescriptionList
                  isCompact
                  isHorizontal
                  data-testid={`chunk-details-${chunk.id}`}
                >
                  {annotation && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Review</DescriptionListTerm>
                      <DescriptionListDescription>
                        {annotation.detail}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  {chunk.status === 'rejected' && chunk.rejectionReason && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Guidance</DescriptionListTerm>
                      <DescriptionListDescription>
                        {chunk.rejectionReason}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  {chunk.binary && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Binary</DescriptionListTerm>
                      <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                        {chunk.binary}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  <DescriptionListGroup>
                    <DescriptionListTerm>Denied</DescriptionListTerm>
                    <DescriptionListDescription>
                      {chunk.hitCount}{' '}
                      {chunk.hitCount === 1 ? 'connection' : 'connections'}
                      {(chunk.firstSeenMs || chunk.lastSeenMs) &&
                        ` (first ${formatTimestamp(chunk.firstSeenMs)} / last ${formatTimestamp(chunk.lastSeenMs)})`}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  {chunk.decidedAtMs ? (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Decided</DescriptionListTerm>
                      <DescriptionListDescription>
                        {formatTimestamp(chunk.decidedAtMs)}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  ) : null}
                  {chunk.validationResult && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Prover</DescriptionListTerm>
                      <DescriptionListDescription>
                        {chunk.validationResult}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  {chunk.supersedesChunkId && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Replaces</DescriptionListTerm>
                      <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                        {chunk.supersedesChunkId}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  {(chunk.denialSummaryIds?.length ?? 0) > 0 && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>
                        Denial summaries
                      </DescriptionListTerm>
                      <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                        {chunk.denialSummaryIds?.join(', ')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  {chunk.candidateEffectivePolicyHash && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>
                        Candidate policy
                      </DescriptionListTerm>
                      <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                        {chunk.candidateEffectivePolicyHash.slice(0, 12)}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  <DescriptionListGroup>
                    <DescriptionListTerm>Chunk</DescriptionListTerm>
                    <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                      {chunk.id}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </StackItem>
              {chunk.proposedRule && (
                <StackItem>
                  <CodeBlock>
                    <CodeBlockCode>
                      {JSON.stringify(chunk.proposedRule, null, 2)}
                    </CodeBlockCode>
                  </CodeBlock>
                </StackItem>
              )}
            </Stack>
          </ExpandableRowContent>
        </Td>
      </Tr>
    </Tbody>
  );
};

export default DraftChunkRow;
