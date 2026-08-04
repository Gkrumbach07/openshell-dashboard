import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
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
};

const EditDraftModal: React.FC<EditDraftModalProps> = ({
  chunk,
  onClose,
  onSave,
  isPending,
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
    let parsed: NetworkPolicyRule;
    try {
      parsed = JSON.parse(editJson) as NetworkPolicyRule;
    } catch {
      setEditJsonError('Invalid JSON');
      return;
    }
    onSave(chunk.id, parsed);
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
