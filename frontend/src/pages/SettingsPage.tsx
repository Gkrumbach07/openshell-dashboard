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
  FormHelperText,
  HelperText,
  HelperTextItem,
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
import SettingValueField from '../components/SettingValueField';
import { useAlerts } from '../app/AlertContext';
import {
  useDeleteGlobalSetting,
  useGlobalSettings,
  useSetGlobalSetting,
} from '../api/settings';
import type { SettingEntry } from '../types';
import {
  emptySettingText,
  formatSettingValue,
  parseSettingValue,
  settingTypeOf,
  type SettingType,
} from '../utils/settings';

const SettingsPage: React.FC = () => {
  const settings = useGlobalSettings();
  const setSetting = useSetGlobalSetting();
  const deleteSetting = useDeleteGlobalSetting();
  const { addSuccess } = useAlerts();

  const [isAddOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addType, setAddType] = useState<SettingType>('string');
  const [addText, setAddText] = useState('');

  // The gateway type-checks every setting, so a value is edited and sent as
  // the type the setting takes. That type is the type of its current value;
  // a setting that was never set has none to go by and the type is chosen.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editType, setEditType] = useState<SettingType>('string');
  const [isEditTypeKnown, setEditTypeKnown] = useState(false);
  const [editText, setEditText] = useState('');

  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const openAdd = () => {
    // Adding and editing share one mutation, so only one of them is open at a
    // time: a refusal of the add must not show under a row being edited.
    setEditKey(null);
    setAddKey('');
    setAddType('string');
    setAddText('');
    setSetting.reset();
    setAddOpen(true);
  };

  const addValue = parseSettingValue(addType, addText);
  const editValue = parseSettingValue(editType, editText);

  const startEdit = (entry: SettingEntry) => {
    const known = settingTypeOf(entry.value);
    const type = known ?? 'string';
    setEditKey(entry.key);
    setEditType(type);
    setEditTypeKnown(known !== undefined);
    setEditText(
      entry.value === undefined ? emptySettingText(type) : String(entry.value),
    );
    setSetting.reset();
  };

  const submitAdd = () => {
    if (!addKey.trim() || addValue === undefined) return;
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
    if (!editKey || editValue === undefined) return;
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
                        <SettingValueField
                          id={`edit-value-${entry.key}`}
                          valueTestId={`edit-value-${entry.key}`}
                          type={editType}
                          canChooseType={!isEditTypeKnown}
                          text={editText}
                          onChange={(type, text) => {
                            setEditType(type);
                            setEditText(text);
                          }}
                          focusOnMount
                        />
                        {(!isEditTypeKnown || setSetting.isError) && (
                          <HelperText isLiveRegion>
                            {!isEditTypeKnown && (
                              <HelperTextItem>
                                This setting has no value, so the gateway does
                                not report its type. Choose the type it takes.
                              </HelperTextItem>
                            )}
                            {setSetting.isError && (
                              <HelperTextItem
                                variant="error"
                                data-testid={`edit-error-${entry.key}`}
                              >
                                {(setSetting.error as Error).message}
                              </HelperTextItem>
                            )}
                          </HelperText>
                        )}
                      </Form>
                    ) : (
                      formatSettingValue(entry.value)
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
                            isDisabled={
                              editValue === undefined || setSetting.isPending
                            }
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
                            onClick={() => startEdit(entry)}
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
              <SettingValueField
                id="setting-value"
                valueTestId="new-setting-value"
                type={addType}
                canChooseType
                text={addText}
                onChange={(type, text) => {
                  setAddType(type);
                  setAddText(text);
                }}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    The gateway takes each setting in one type and rejects a
                    value of any other.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
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
            isDisabled={
              !addKey.trim() || addValue === undefined || setSetting.isPending
            }
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
        error={
          deleteSetting.isError
            ? (deleteSetting.error as Error).message
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteKey(null)}
      />
    </>
  );
};

export default SettingsPage;
