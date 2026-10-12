import { useState } from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';

import { useUserRole } from '../api/rbac';
import { useAddMember } from '../api/workspaces';
import { useAlerts } from '../app/AlertContext';
import { useI18n } from '../i18n';
import type { WorkspaceRole } from '../types';

type AddMemberModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
};

const AddMemberModal: React.FC<AddMemberModalProps> = ({
  workspace,
  isOpen,
  onClose,
}) => {
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('USER');
  const addMember = useAddMember(workspace);
  const { addSuccess } = useAlerts();
  const { isPlatformAdmin } = useUserRole();
  const { t } = useI18n('workspaces');
  const { t: tCommon } = useI18n('common');

  // The gateway stores the subject as it is sent and matches it exactly, so
  // a space pasted along with it would make a member nobody can sign in as.
  const principalSubject = subject.trim();

  const close = () => {
    setSubject('');
    setRole('USER');
    addMember.reset();
    onClose();
  };

  const submit = () => {
    if (!principalSubject || addMember.isPending) {
      return;
    }
    addMember.mutate(
      { principalSubject, role },
      {
        onSuccess: () => {
          addSuccess('Member added');
          close();
        },
      },
    );
  };

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={close}
      aria-label="Add member"
    >
      <ModalHeader title="Add workspace member" />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup
            label="Principal subject"
            isRequired
            fieldId="member-subject"
          >
            <TextInput
              id="member-subject"
              data-testid="member-subject-input"
              isRequired
              value={subject}
              onChange={(_event, value) => setSubject(value)}
              aria-describedby="member-subject-help"
            />
            <FormHelperText>
              <HelperText id="member-subject-help">
                <HelperTextItem data-testid="member-subject-help">
                  {t('members.add.subjectHelp', {
                    action: tCommon('header.copySubject'),
                  })}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Role" isRequired fieldId="member-role">
            <FormSelect
              id="member-role"
              data-testid="member-role-select"
              value={role}
              onChange={(_event, value) => setRole(value as WorkspaceRole)}
            >
              <FormSelectOption value="USER" label="User" />
              {isPlatformAdmin && (
                <FormSelectOption value="ADMIN" label="Admin" />
              )}
            </FormSelect>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  To change a role later, remove the member and re-add them —
                  the API has no role-update operation.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {addMember.isError && (
            <Alert variant="danger" isInline title="Add member failed">
              {(addMember.error as Error).message}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!principalSubject || addMember.isPending}
          isLoading={addMember.isPending}
          data-testid="add-member-submit"
        >
          Add
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddMemberModal;
