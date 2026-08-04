import React from 'react';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockCode,
  Content,
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

import { chunkStatusColor, chunkStatusIcon } from './utils';
import type { useDraftActions } from './useDraftActions';
import type { PolicyChunk } from '../../types';

type DraftChunkRowProps = {
  chunk: PolicyChunk;
  rowIndex: number;
  isOpen: boolean;
  isWorkspaceAdmin: boolean;
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
  onToggle,
  onEdit,
  actions,
  rejecting,
  rejectReason,
  onSetRejecting,
  onSetRejectReason,
}) => {
  const { approve, reject, undo } = actions;

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
        <Td dataLabel="Confidence">{chunk.confidence.toFixed(2)}</Td>
        <Td dataLabel="Proposed">
          <Timestamp date={new Date(chunk.createdAtMs)} />
        </Td>
        {isWorkspaceAdmin && (
          <Td isActionCell>
            <Flex flexWrap={{ default: 'nowrap' }} gap={{ default: 'gapSm' }}>
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
                      onClick={() => onEdit(chunk)}
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
                        onSetRejecting(chunk.id);
                        if (!isOpen) onToggle();
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
                  {chunk.binary && <>binary: {chunk.binary} &middot; </>}
                  hits: {chunk.hitCount}
                  {chunk.validationResult && (
                    <> &middot; prover: {chunk.validationResult}</>
                  )}
                  {chunk.rejectionReason && (
                    <> &middot; rejected: {chunk.rejectionReason}</>
                  )}
                </Content>
              </StackItem>
            </Stack>
          </ExpandableRowContent>
        </Td>
      </Tr>
    </Tbody>
  );
};

export default DraftChunkRow;
