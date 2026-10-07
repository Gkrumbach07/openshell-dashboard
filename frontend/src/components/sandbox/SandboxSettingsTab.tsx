import { useState } from 'react';
import {
  ActionList,
  ActionListItem,
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { PencilAltIcon, TrashIcon } from '@patternfly/react-icons';

import { useWorkspaceRole } from '../../api/rbac';
import {
  useDeleteSandboxSetting,
  useSandboxSettings,
  useSetSandboxSetting,
} from '../../api/sandboxSettings';
import { useAlerts } from '../../app/AlertContext';
import ConfirmDeleteModal from '../ConfirmDeleteModal';
import RefreshErrorAlert, { isRefreshError } from '../RefreshErrorAlert';
import SettingValueField from '../SettingValueField';
import type {
  PolicySource,
  SandboxSettingEntry,
  SettingScope,
} from '../../types';
import {
  emptySettingText,
  formatSettingValue,
  parseSettingValue,
  settingTypeOf,
  type SettingType,
} from '../../utils/settings';

type SandboxSettingsTabProps = {
  workspace: string;
  sandboxName: string;
};

const SCOPE_LABELS: Record<
  SettingScope,
  { text: string; color: 'blue' | 'orange' | 'grey' }
> = {
  SANDBOX: { text: 'Sandbox', color: 'blue' },
  GLOBAL: { text: 'Global', color: 'orange' },
  UNSPECIFIED: { text: 'Not set', color: 'grey' },
};

const POLICY_SOURCES: Record<PolicySource, string> = {
  SANDBOX: 'Sandbox',
  GLOBAL: 'Global',
  UNSPECIFIED: '-',
};

// What the gateway does with a policy the sandbox rejects.
const FAILURE_MODES: Record<string, string> = {
  fail_closed: 'Fail closed',
  retain_last_valid: 'Retain the last valid policy',
};

// Why a setting that is set on the gateway cannot be changed here. The gateway
// refuses both a write and a delete on the sandbox while the key is set
// globally, so neither is offered.
const managedGlobally = (key: string): string =>
  `"${key}" is set on the gateway, which overrides the sandbox. Delete the global setting to set it here.`;

// The settings in effect for one sandbox (`openshell settings get|set|delete
// <sandbox>`): each key with its value and the scope the value comes from.
//
// Reading needs workspace membership; writing needs the workspace admin role,
// which is the gateway's rule, so the controls are shown to admins only.
const SandboxSettingsTab: React.FC<SandboxSettingsTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const settings = useSandboxSettings(workspace, sandboxName);
  const setSetting = useSetSandboxSetting(workspace, sandboxName);
  const deleteSetting = useDeleteSandboxSetting(workspace, sandboxName);
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const { addAlert, addSuccess } = useAlerts();

  const [isAddOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addType, setAddType] = useState<SettingType>('string');
  const [addText, setAddText] = useState('');

  // As on the gateway's Settings page: a value is edited and sent in the type
  // the setting takes, which is the type of its current value. A setting
  // without a value has none to go by, and the type is chosen.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editType, setEditType] = useState<SettingType>('string');
  const [isEditTypeKnown, setEditTypeKnown] = useState(false);
  const [editText, setEditText] = useState('');

  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const entries = settings.data?.settings ?? [];
  const scopeOf = (key: string): SettingScope | undefined =>
    entries.find((entry) => entry.key === key)?.scope;

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
  const addKeyIsGlobal = scopeOf(addKey.trim()) === 'GLOBAL';

  const startEdit = (entry: SandboxSettingEntry) => {
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
    const key = addKey.trim();
    if (!key || addValue === undefined || addKeyIsGlobal) return;
    setSetting.mutate(
      { key, value: addValue },
      {
        onSuccess: () => {
          setAddOpen(false);
          addSuccess(`Setting "${key}" saved`);
        },
      },
    );
  };

  const submitEdit = () => {
    if (!editKey || editValue === undefined) return;
    // The row may have turned global since the edit began.
    if (scopeOf(editKey) === 'GLOBAL') return;
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
      onSuccess: (result) => {
        setDeleteKey(null);
        // The gateway says whether there was anything to delete.
        if (result.deleted) {
          addSuccess(`Setting "${deleteKey}" deleted`);
        } else {
          addAlert(`Setting "${deleteKey}" was not set on this sandbox`);
        }
      },
    });
  };

  if (settings.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading sandbox settings" />
      </Bullseye>
    );
  }

  // The settings are re-read while the tab is open. A refresh that fails
  // leaves them, and a value being edited or a setting being added, as they
  // were, with a note above; only settings that never loaded are replaced by
  // the error.
  const refreshFailed = isRefreshError(settings);
  if ((settings.isError && !refreshFailed) || !settings.data) {
    return (
      <Alert
        variant="danger"
        title="Failed to load sandbox settings"
        actionLinks={
          <Button variant="link" onClick={() => settings.refetch()}>
            Retry
          </Button>
        }
      >
        {(settings.error as Error | null)?.message}
      </Alert>
    );
  }

  const config = settings.data;
  const isGlobalPolicy = config.policySource === 'GLOBAL';

  return (
    <Stack hasGutter>
      {refreshFailed && (
        <StackItem>
          <RefreshErrorAlert
            title="The sandbox settings could not be refreshed"
            error={settings.error}
            onRetry={() => settings.refetch()}
            data-testid="sandbox-settings-refresh-error"
          />
        </StackItem>
      )}
      <StackItem>
        <Card data-testid="sandbox-config-card">
          <CardTitle>Effective configuration</CardTitle>
          <CardBody>
            <DescriptionList isHorizontal isCompact>
              <DescriptionListGroup>
                <DescriptionListTerm>Policy source</DescriptionListTerm>
                <DescriptionListDescription data-testid="sandbox-policy-source">
                  {POLICY_SOURCES[config.policySource] ?? config.policySource}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Policy revision</DescriptionListTerm>
                <DescriptionListDescription data-testid="sandbox-policy-revision">
                  {(isGlobalPolicy && config.globalPolicyVersion) ||
                    config.policyVersion ||
                    '-'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Policy hash</DescriptionListTerm>
                <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                  {config.policyHash || '-'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Config revision</DescriptionListTerm>
                <DescriptionListDescription
                  className="pf-v6-u-font-family-monospace"
                  data-testid="sandbox-config-revision"
                >
                  {config.configRevision}
                </DescriptionListDescription>
              </DescriptionListGroup>
              {config.policyValidationFailureMode && (
                <DescriptionListGroup>
                  <DescriptionListTerm>
                    When a policy is rejected
                  </DescriptionListTerm>
                  <DescriptionListDescription>
                    {FAILURE_MODES[config.policyValidationFailureMode] ??
                      config.policyValidationFailureMode}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
            {isGlobalPolicy && (
              <Alert
                variant="info"
                isInline
                isPlain
                title="This sandbox runs the gateway-global policy. Its own policy applies again once the global policy is removed."
                className="pf-v6-u-mt-md"
                data-testid="sandbox-global-policy-note"
              />
            )}
          </CardBody>
        </Card>
      </StackItem>
      <StackItem>
        {isWorkspaceAdmin && (
          <Toolbar aria-label="Sandbox setting actions">
            <ToolbarContent>
              <ToolbarItem>
                <Button onClick={openAdd} data-testid="add-sandbox-setting">
                  Add setting
                </Button>
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        )}
        {entries.length === 0 ? (
          <Content component="p">No settings available.</Content>
        ) : (
          <Table
            aria-label="Sandbox settings"
            variant="compact"
            data-testid="sandbox-settings-table"
          >
            <Thead>
              <Tr>
                <Th>Key</Th>
                <Th>Value</Th>
                <Th>Scope</Th>
                {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            <Tbody>
              {entries.map((entry) => {
                const scope = SCOPE_LABELS[entry.scope] ?? {
                  text: entry.scope,
                  color: 'grey' as const,
                };
                const isEditing = editKey === entry.key;
                return (
                  <Tr key={entry.key}>
                    <Td
                      dataLabel="Key"
                      className="pf-v6-u-font-family-monospace"
                    >
                      {entry.key}
                    </Td>
                    <Td
                      dataLabel="Value"
                      className="pf-v6-u-font-family-monospace"
                    >
                      {isEditing ? (
                        <Form
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitEdit();
                          }}
                        >
                          <SettingValueField
                            id={`edit-sandbox-value-${entry.key}`}
                            valueTestId={`edit-sandbox-value-${entry.key}`}
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
                                  data-testid={`edit-sandbox-error-${entry.key}`}
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
                    <Td dataLabel="Scope">
                      <Label
                        color={scope.color}
                        isCompact
                        data-testid={`scope-${entry.key}`}
                      >
                        {scope.text}
                      </Label>
                    </Td>
                    {isWorkspaceAdmin && (
                      <Td dataLabel="Actions" isActionCell>
                        {/* A row can turn global while it is being edited.
                            It then keeps its Cancel, and the refusal that
                            said so, but can no longer be saved. */}
                        {entry.scope === 'GLOBAL' && !isEditing && (
                          <Content
                            component="small"
                            data-testid={`managed-globally-${entry.key}`}
                          >
                            Managed globally
                          </Content>
                        )}
                        {isEditing && (
                          <ActionList isIconList>
                            <ActionListItem>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={submitEdit}
                                isDisabled={
                                  editValue === undefined ||
                                  entry.scope === 'GLOBAL' ||
                                  setSetting.isPending
                                }
                                isLoading={setSetting.isPending}
                                data-testid={`save-sandbox-${entry.key}`}
                              >
                                Save
                              </Button>
                            </ActionListItem>
                            <ActionListItem>
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() => setEditKey(null)}
                                data-testid={`cancel-sandbox-edit-${entry.key}`}
                              >
                                Cancel
                              </Button>
                            </ActionListItem>
                          </ActionList>
                        )}
                        {entry.scope !== 'GLOBAL' && !isEditing && (
                          <ActionList isIconList>
                            <ActionListItem>
                              <Button
                                variant="plain"
                                aria-label={`Edit ${entry.key}`}
                                onClick={() => startEdit(entry)}
                                data-testid={`edit-sandbox-${entry.key}`}
                              >
                                <PencilAltIcon />
                              </Button>
                            </ActionListItem>
                            {/* Only a value set on the sandbox can be deleted
                                from it. */}
                            {entry.scope === 'SANDBOX' && (
                              <ActionListItem>
                                <Button
                                  variant="plain"
                                  isDanger
                                  aria-label={`Delete ${entry.key}`}
                                  onClick={() => {
                                    deleteSetting.reset();
                                    setDeleteKey(entry.key);
                                  }}
                                  data-testid={`delete-sandbox-${entry.key}`}
                                >
                                  <TrashIcon />
                                </Button>
                              </ActionListItem>
                            )}
                          </ActionList>
                        )}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
        <Content
          component="small"
          className="pf-v6-u-mt-sm"
          data-testid="sandbox-settings-scope-note"
        >
          A setting takes its value from the gateway when it is set there
          (Global), otherwise from this sandbox (Sandbox). A global setting has
          to be deleted before the key can be set or deleted on a sandbox.
        </Content>
      </StackItem>

      <Modal
        variant="small"
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        aria-label="Add sandbox setting"
      >
        <ModalHeader title="Add setting" />
        <ModalBody>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              submitAdd();
            }}
          >
            <FormGroup label="Key" isRequired fieldId="sandbox-setting-key">
              <TextInput
                id="sandbox-setting-key"
                data-testid="new-sandbox-setting-key"
                value={addKey}
                onChange={(_e, val) => setAddKey(val)}
                isRequired
                validated={addKeyIsGlobal ? 'error' : 'default'}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              {addKeyIsGlobal && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant="error"
                      data-testid="new-sandbox-setting-global"
                    >
                      {managedGlobally(addKey.trim())}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
            <FormGroup label="Value" fieldId="sandbox-setting-value">
              <SettingValueField
                id="sandbox-setting-value"
                valueTestId="new-sandbox-setting-value"
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
                    value of any other. The setting applies to this sandbox
                    only.
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
              !addKey.trim() ||
              addValue === undefined ||
              addKeyIsGlobal ||
              setSetting.isPending
            }
            isLoading={setSetting.isPending}
            data-testid="confirm-add-sandbox-setting"
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
        body={`Setting "${deleteKey}" will be removed from sandbox "${sandboxName}", which then follows the gateway default for it.`}
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
    </Stack>
  );
};

export default SandboxSettingsTab;
