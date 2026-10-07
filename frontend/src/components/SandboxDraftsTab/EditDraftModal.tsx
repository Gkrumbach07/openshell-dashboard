import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Stack,
  StackItem,
  TextArea,
} from '@patternfly/react-core';

import type { NetworkPolicyRule, PolicyChunk } from '../../types';

type EditDraftModalProps = {
  chunk: PolicyChunk | null;
  onClose: () => void;
  onSave: (chunkId: string, proposedRule: NetworkPolicyRule) => void;
  isPending: boolean;
  // Why the last save was refused, by the BFF's schema check or the gateway.
  error?: string;
};

// Edits a pending proposal's rule as the document the gateway holds: every
// field of the rule is in the JSON, and what is saved replaces the proposed
// rule whole, so a field left as it is stays as it is.
const EditDraftModal: React.FC<EditDraftModalProps> = ({
  chunk,
  onClose,
  onSave,
  isPending,
  error,
}) => {
  const [editJson, setEditJson] = useState('');
  const [editJsonError, setEditJsonError] = useState('');

  useEffect(() => {
    if (chunk) {
      setEditJson(JSON.stringify(chunk.proposedRule ?? {}, null, 2));
      setEditJsonError('');
    }
  }, [chunk]);

  const handleSave = () => {
    if (!chunk) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editJson);
    } catch {
      setEditJsonError('Invalid JSON');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setEditJsonError('The rule must be a JSON object');
      return;
    }
    onSave(chunk.id, parsed as NetworkPolicyRule);
  };

  if (!chunk) return null;

  return (
    <Modal
      isOpen
      onEscapePress={onClose}
      onClose={onClose}
      aria-label="Edit draft chunk"
      variant="medium"
      data-testid="edit-chunk-modal"
      appendTo={document.body}
    >
      <ModalHeader
        title={`Edit proposed rule: ${chunk.ruleName || chunk.id}`}
      />
      <ModalBody>
        <Stack hasGutter>
          <StackItem>
            <Content component="small">
              The whole rule, with the gateway&apos;s field names. Saving
              replaces the proposed rule with this document and the gateway
              evaluates it again before it can be approved.
            </Content>
          </StackItem>
          {editJsonError && (
            <StackItem>
              <Alert variant="danger" isInline title={editJsonError} />
            </StackItem>
          )}
          {error && !editJsonError && (
            <StackItem>
              <Alert
                variant="danger"
                isInline
                title="The rule was not saved"
                data-testid="edit-chunk-error"
              >
                {error}
              </Alert>
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
              resizeOrientation="vertical"
              className="pf-v6-u-font-family-monospace"
            />
          </StackItem>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSave}
          isLoading={isPending}
          isDisabled={isPending}
          data-testid="save-edit-chunk"
        >
          Save
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default EditDraftModal;
