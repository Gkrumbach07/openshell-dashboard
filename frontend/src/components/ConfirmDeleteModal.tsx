import { useState } from 'react';
import {
  Alert,
  Button,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';

type ConfirmDeleteModalProps = {
  title: string;
  body: string;
  isOpen: boolean;
  isDeleting: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** When set, the user must type this name to enable the confirm button. Use for irreversible deletions. */
  confirmName?: string;
  /** 'delete' uses danger button (irreversible). 'remove' uses primary button (reversible, e.g. member removal). */
  variant?: 'delete' | 'remove';
};

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  title,
  body,
  isOpen,
  isDeleting,
  error,
  onConfirm,
  onCancel,
  confirmName,
  variant = 'delete',
}) => {
  const [typedName, setTypedName] = useState('');
  const nameMatches = !confirmName || typedName === confirmName;

  const close = () => {
    setTypedName('');
    onCancel();
  };

  return (
    <Modal variant="small" isOpen={isOpen} onClose={close} aria-label={title}>
      <ModalHeader title={title} titleIconVariant="warning" />
      <ModalBody>
        {body}
        {confirmName && (
          <FormGroup
            label={`Type "${confirmName}" to confirm`}
            fieldId="confirm-delete-name"
            className="pf-v6-u-mt-md"
          >
            <TextInput
              id="confirm-delete-name"
              data-testid="confirm-delete-name-input"
              value={typedName}
              onChange={(_event, value) => setTypedName(value)}
              validated={typedName && !nameMatches ? 'error' : 'default'}
            />
            {typedName && !nameMatches && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant="error">
                    Name does not match
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
        )}
        {error && (
          <Alert
            variant="danger"
            isInline
            title={variant === 'remove' ? 'Remove failed' : 'Delete failed'}
            className="pf-v6-u-mt-md"
          >
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant={variant === 'remove' ? 'primary' : 'danger'}
          onClick={onConfirm}
          isLoading={isDeleting}
          isDisabled={isDeleting || !nameMatches}
          data-testid="confirm-delete"
        >
          {variant === 'remove' ? 'Remove' : 'Delete'}
        </Button>
        <Button variant="link" onClick={close} isDisabled={isDeleting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ConfirmDeleteModal;
