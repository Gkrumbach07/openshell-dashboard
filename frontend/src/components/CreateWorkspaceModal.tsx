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
import KeyValueEditor from './KeyValueEditor';

type CreateWorkspaceModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type LabelRow = { key: string; value: string };

// The labels the rows describe. A row without a key is not a label and is
// left out; a key given twice keeps its last value. Undefined when there are
// none, so that a workspace without labels is created by the same request as
// before.
const labelsFromRows = (
  rows: LabelRow[],
): Record<string, string> | undefined => {
  const labels: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      labels[key] = row.value.trim();
    }
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
};

const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [labelRows, setLabelRows] = useState<LabelRow[]>([]);
  const createWorkspace = useCreateWorkspace();
  const { addSuccess } = useAlerts();

  const close = () => {
    setName('');
    setLabelRows([]);
    createWorkspace.reset();
    onClose();
  };

  const submit = () => {
    const labels = labelsFromRows(labelRows);
    createWorkspace.mutate(labels ? { name, labels } : { name }, {
      onSuccess: () => {
        addSuccess('Workspace created');
        close();
      },
    });
  };

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={close}
      aria-label="Create workspace"
    >
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
                  Lowercase alphanumeric and dashes (DNS-1123 label), at most 19
                  characters, e.g. team-a
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Labels" role="group" fieldId="workspace-labels">
            {/* The editor's rows are a Stack, which is as tall as its
                container. Directly in the form group that is the height of
                the whole group, so the Add button and the help text below it
                are pushed out of the dialog. A container of its own gives the
                rows their natural height. */}
            <div>
              <KeyValueEditor
                rows={labelRows}
                onChange={setLabelRows}
                keyPlaceholder="key, e.g. env"
                valuePlaceholder="value, e.g. staging"
                testIdPrefix="workspace-label"
                addLabel="Add label"
                itemLabel="Label"
              />
            </div>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Labels can be used to filter the workspace list. They cannot
                  be changed after the workspace is created.
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
