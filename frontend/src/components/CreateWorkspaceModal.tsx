import { useState } from 'react';
import {
  Alert,
  Button,
  Form,
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

import { useCreateWorkspace } from '../api/workspaces';
import { useAlerts } from '../app/AlertContext';

type CreateWorkspaceModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const createWorkspace = useCreateWorkspace();
  const { addSuccess } = useAlerts();

  const close = () => {
    setName('');
    createWorkspace.reset();
    onClose();
  };

  const submit = () => {
    createWorkspace.mutate({ name }, { onSuccess: () => { addSuccess('Workspace created'); close(); } });
  };

  return (
    <Modal variant="small" isOpen={isOpen} onClose={close} aria-label="Create workspace">
      <ModalHeader title="Create workspace" />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup label="Name" isRequired fieldId="workspace-name">
            <TextInput
              id="workspace-name"
              data-testid="workspace-name-input"
              isRequired
              value={name}
              onChange={(_event, value) => setName(value)}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Lowercase alphanumeric and dashes (DNS-1123 label), e.g. team-a
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {createWorkspace.isError && (
            <Alert variant="danger" isInline title="Create failed">
              {(createWorkspace.error as Error).message}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!name || createWorkspace.isPending}
          isLoading={createWorkspace.isPending}
          data-testid="create-workspace-submit"
        >
          Create
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateWorkspaceModal;
