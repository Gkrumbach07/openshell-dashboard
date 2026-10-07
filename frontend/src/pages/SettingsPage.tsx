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
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import SettingValueField from '../components/SettingValueField';
import { useAlerts } from '../app/AlertContext';
import {
  useDeleteGlobalSetting,
  useGlobalSettings,
  useSetGlobalSetting,
} from '../api/settings';
import type { SettingEntry, SettingValue } from '../types';
import {
  emptySettingText,
  formatSettingValue,
  parseSettingValue,
  settingTypeOf,
  type SettingType,
} from '../utils/settings';

// A setting that is about to be written, waiting for the user to confirm it.
// `from` is where it was entered, which is where a refusal is shown.
type PendingSetting = {
  key: string;
  value: SettingValue;
  from: 'add' | 'edit';
};

// The type a value is sent in, in words: "a string", "a boolean".
const settingTypeLabel = (value: SettingValue): string => {
  switch (settingTypeOf(value)) {
    case 'boolean':
      return 'a boolean';
    case 'integer':
      return 'an integer';
    default:
      return 'a string';
  }
};

const SettingsPage: React.FC = () => {
  const settings = useGlobalSettings();
  const setSetting = useSetGlobalSetting();
  const deleteSetting = useDeleteGlobalSetting();
  const { addAlert, addSuccess } = useAlerts();

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

  // A global setting reaches every sandbox on the gateway the moment it is
  // written, so nothing is written before the user has seen exactly what
  // will be and said yes to it, as in the TUI.
  const [pending, setPending] = useState<PendingSetting | null>(null);

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
    // The form makes way for the question and comes back, as it was, if the
    // answer is no or the gateway refuses the value.
    setAddOpen(false);
    setSetting.reset();
    setPending({ key: addKey.trim(), value: addValue, from: 'add' });
  };

  const submitEdit = () => {
    if (!editKey || editValue === undefined) return;
    setSetting.reset();
    setPending({ key: editKey, value: editValue, from: 'edit' });
  };

  const cancelPending = () => {
    if (pending?.from === 'add') {
      setAddOpen(true);
    }
    setPending(null);
  };

  const confirmPending = () => {
    if (!pending) return;
    const { key, value, from } = pending;
    setSetting.mutate(
      { key, value },
      {
        onSuccess: () => {
          setPending(null);
          if (from === 'edit') {
            setEditKey(null);
          }
          addSuccess(
            from === 'add'
              ? `Setting "${key}" saved`
              : `Setting "${key}" updated`,
          );
        },
        // The gateway's reason is shown where the value was entered, so that
        // it can be corrected there: under the row, or in the form.
        onError: () => {
          setPending(null);
          if (from === 'add') {
            setAddOpen(true);
          }
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deleteKey) return;
    deleteSetting.mutate(deleteKey, {
      onSuccess: (result) => {
        setDeleteKey(null);
        // The gateway says whether there was anything to delete.
        if (result.deleted) {
          addSuccess(`Setting "${deleteKey}" deleted`);
        } else {
          addAlert(
            `Setting "${deleteKey}" was not set, so nothing was deleted`,
          );
        }
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

  // Only a first load that failed takes the page. A refresh that failed
  // leaves the settings that loaded before on screen, with a note above them.
  const refreshFailed = isRefreshError(settings);
  if (settings.isError && !refreshFailed) {
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
        {refreshFailed && (
          <RefreshErrorAlert
            title="The settings could not be refreshed"
            error={settings.error}
            onRetry={() => settings.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="settings-refresh-error"
          />
        )}
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
              data-testid="add-setting-error"
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

      {/* The question before a setting is written: `Set k = v globally?` */}
      <Modal
        variant="small"
        isOpen={pending !== null}
        onClose={cancelPending}
        aria-label="Confirm global setting change"
        data-testid="confirm-set-modal"
      >
        <ModalHeader
          title="Confirm global setting change"
          titleIconVariant="warning"
        />
        <ModalBody>
          <Content component="p" data-testid="confirm-set-question">
            Set{' '}
            <span className="pf-v6-u-font-family-monospace">
              {pending?.key} ={' '}
              {pending ? formatSettingValue(pending.value) : ''}
            </span>{' '}
            globally?
          </Content>
          {/* true the boolean and "true" the string read alike above, and the
              gateway takes only one of them for a given key. */}
          <Content component="p" data-testid="confirm-set-type">
            The value is sent as{' '}
            {pending ? settingTypeLabel(pending.value) : ''}.
          </Content>
          <Content component="p">
            This will apply to all sandboxes on this gateway.
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={confirmPending}
            isDisabled={setSetting.isPending}
            isLoading={setSetting.isPending}
            data-testid="confirm-set-setting"
          >
            Set globally
          </Button>
          <Button
            variant="link"
            onClick={cancelPending}
            isDisabled={setSetting.isPending}
            data-testid="cancel-set-setting"
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDeleteModal
        title="Delete setting?"
        body={`Delete the global setting "${deleteKey}"? This will unset the value for all sandboxes on this gateway.`}
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
