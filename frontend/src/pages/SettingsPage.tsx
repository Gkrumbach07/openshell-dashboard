import { useState } from 'react';
import {
  ActionList,
  ActionListItem,
  Alert,
  Bullseye,
  Button,
  Content,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { PencilAltIcon, TrashIcon } from '@patternfly/react-icons';

import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { useAlerts } from '../app/AlertContext';
import {
  useDeleteGlobalSetting,
  useGlobalSettings,
  useSetGlobalSetting,
} from '../api/settings';

const SettingsPage: React.FC = () => {
  const settings = useGlobalSettings();
  const setSetting = useSetGlobalSetting();
  const deleteSetting = useDeleteGlobalSetting();
  const { addSuccess } = useAlerts();

  const [isAddOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addValue, setAddValue] = useState('');

  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const openAdd = () => {
    setAddKey('');
    setAddValue('');
    setSetting.reset();
    setAddOpen(true);
  };

  const submitAdd = () => {
    if (!addKey.trim()) return;
    setSetting.mutate(
      { key: addKey.trim(), value: addValue },
      {
        onSuccess: () => {
          setAddOpen(false);
          addSuccess(`Setting "${addKey.trim()}" saved`);
        },
      },
    );
  };

  const submitEdit = () => {
    if (!editKey) return;
    setSetting.mutate(
      { key: editKey, value: editValue },
      {
        onSuccess: () => {
          setEditKey(null);
          addSuccess(`Setting "${editKey}" updated`);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deleteKey) return;
    deleteSetting.mutate(deleteKey, {
      onSuccess: () => {
        setDeleteKey(null);
        addSuccess(`Setting "${deleteKey}" deleted`);
      },
    });
  };

  if (settings.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading settings" />
        </Bullseye>
      </PageSection>
    );
  }

  if (settings.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title="Failed to load gateway settings"
          actionLinks={
            <Button variant="link" onClick={() => settings.refetch()}>
              Retry
            </Button>
          }
        >
          {(settings.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const entries = settings.data?.settings ?? [];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Settings</Title>
        <Content component="p">
          Gateway configuration settings. Changes take effect immediately.
          Platform Admin only.
        </Content>
      </PageSection>
      <PageSection>
        <Toolbar aria-label="Settings actions">
          <ToolbarContent>
            <ToolbarItem>
              <Button onClick={openAdd} data-testid="add-setting">
                Add setting
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
        {entries.length === 0 ? (
          <Content component="p">No settings configured.</Content>
        ) : (
          <Table
            aria-label="Gateway settings"
            variant="compact"
            data-testid="settings-table"
          >
            <Thead>
              <Tr>
                <Th>Key</Th>
                <Th>Value</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {entries.map((entry) => (
                <Tr key={entry.key}>
                  <Td dataLabel="Key" className="pf-v6-u-font-family-monospace">
                    {entry.key}
                  </Td>
                  <Td
                    dataLabel="Value"
                    className="pf-v6-u-font-family-monospace"
                  >
                    {editKey === entry.key ? (
                      <Form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitEdit();
                        }}
                      >
                        <TextInput
                          aria-label="Edit value"
                          data-testid={`edit-value-${entry.key}`}
                          value={editValue}
                          onChange={(_e, val) => setEditValue(val)}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                      </Form>
                    ) : (
                      entry.value || '—'
                    )}
                  </Td>
                  <Td dataLabel="Actions" isActionCell>
                    {editKey === entry.key ? (
                      <ActionList isIconList>
                        <ActionListItem>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={submitEdit}
                            isDisabled={setSetting.isPending}
                            isLoading={setSetting.isPending}
                            data-testid={`save-${entry.key}`}
                          >
                            Save
                          </Button>
                        </ActionListItem>
                        <ActionListItem>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => setEditKey(null)}
                            data-testid={`cancel-edit-${entry.key}`}
                          >
                            Cancel
                          </Button>
                        </ActionListItem>
                      </ActionList>
                    ) : (
                      <ActionList isIconList>
                        <ActionListItem>
                          <Button
                            variant="plain"
                            aria-label={`Edit ${entry.key}`}
                            onClick={() => {
                              setEditKey(entry.key);
                              setEditValue(entry.value);
                              setSetting.reset();
                            }}
                            data-testid={`edit-${entry.key}`}
                          >
                            <PencilAltIcon />
                          </Button>
                        </ActionListItem>
                        <ActionListItem>
                          <Button
                            variant="plain"
                            isDanger
                            aria-label={`Delete ${entry.key}`}
                            onClick={() => {
                              deleteSetting.reset();
                              setDeleteKey(entry.key);
                            }}
                            data-testid={`delete-${entry.key}`}
                          >
                            <TrashIcon />
                          </Button>
                        </ActionListItem>
                      </ActionList>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        {settings.data && (
          <Content
            component="small"
            className="pf-v6-u-mt-sm pf-v6-u-color-200"
          >
            Settings revision: {settings.data.settingsRevision}
          </Content>
        )}
      </PageSection>

      {/* Add setting modal */}
      <Modal
        variant="small"
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        aria-label="Add setting"
      >
        <ModalHeader title="Add setting" />
        <ModalBody>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              submitAdd();
            }}
          >
            <FormGroup label="Key" isRequired fieldId="setting-key">
              <TextInput
                id="setting-key"
                data-testid="new-setting-key"
                value={addKey}
                onChange={(_e, val) => setAddKey(val)}
                isRequired
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Value" fieldId="setting-value">
              <TextInput
                id="setting-value"
                data-testid="new-setting-value"
                value={addValue}
                onChange={(_e, val) => setAddValue(val)}
              />
            </FormGroup>
          </Form>
          {setSetting.isError && (
            <Alert
              variant="danger"
              isInline
              title="Failed to save setting"
              className="pf-v6-u-mt-md"
            >
              {(setSetting.error as Error).message}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={submitAdd}
            isDisabled={!addKey.trim() || setSetting.isPending}
            isLoading={setSetting.isPending}
            data-testid="confirm-add-setting"
          >
            Save
          </Button>
          <Button variant="link" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDeleteModal
        title="Delete setting?"
        body={`Are you sure you want to delete the setting "${deleteKey}"?`}
        isOpen={deleteKey !== null}
        isDeleting={deleteSetting.isPending}
        error={deleteSetting.isError ? (deleteSetting.error as Error).message : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteKey(null)}
      />
    </>
  );
};

export default SettingsPage;
