import React, { useMemo, useState } from 'react';
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
  Spinner,
  TextInput,
} from '@patternfly/react-core';

import {
  useCreateProvider,
  useProviderProfiles,
  useUpdateProvider,
} from '../../api/providers';
import { useAlerts } from '../../app/AlertContext';
import { useSlots } from '../../slots';
import KeyValueEditor from '../KeyValueEditor';
import type { CredentialInputSlot, Provider } from '../../types';
import {
  credentialStorageKey,
  parseCredentialExpiry,
} from '../../utils/providerCredentials';
import {
  isAmbiguousProfile,
  profileForProvider,
  profileKey,
  profileWorkspaceFor,
} from '../../utils/providerProfiles';

type ProviderFormModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  renderCredentialInput?: CredentialInputSlot;
} & (
  | { mode: 'create'; provider?: undefined }
  | { mode: 'edit'; provider: Provider }
);

const ProviderFormModal: React.FC<ProviderFormModalProps> = ({
  workspace,
  isOpen,
  onClose,
  onSuccess,
  renderCredentialInput,
  ...modeProps
}) => {
  const isEdit = modeProps.mode === 'edit';
  const existingProvider = isEdit ? modeProps.provider : undefined;

  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const [name, setName] = useState('');
  // The chosen profile, by profileKey: one id can be listed in two scopes.
  const [selectedKey, setSelectedKey] = useState('');
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({});
  const [expiryValues, setExpiryValues] = useState<Record<string, string>>({});
  const [configRows, setConfigRows] = useState<
    { key: string; value: string }[]
  >(
    existingProvider
      ? Object.entries(existingProvider.config ?? {}).map(([key, value]) => ({
          key,
          value,
        }))
      : [],
  );
  const profiles = useProviderProfiles(workspace);
  const createProvider = useCreateProvider(workspace);
  const updateProvider = useUpdateProvider(workspace);
  const { addSuccess } = useAlerts();

  const mutation = isEdit ? updateProvider : createProvider;

  // Editing, it is the profile the gateway resolves the provider's type to;
  // creating, the one picked from the list.
  const selectedProfile = useMemo(() => {
    const listed = profiles.data ?? [];
    return existingProvider
      ? profileForProvider(listed, existingProvider)
      : listed.find((profile) => profileKey(profile) === selectedKey);
  }, [profiles.data, existingProvider, selectedKey]);

  const requiredMissing =
    !isEdit &&
    (selectedProfile?.credentials ?? [])
      .filter((credential) => credential.required)
      .some((credential) => !credentialValues[credential.name]);

  // An expiry that is not a time still to come is never sent: the gateway
  // would take the credential as expired and switch it off.
  const expiryInvalid = (credentialName: string): boolean =>
    Number.isNaN(parseCredentialExpiry(expiryValues[credentialName] ?? ''));
  const anyExpiryInvalid = (selectedProfile?.credentials ?? []).some(
    (credential) => expiryInvalid(credential.name),
  );

  const close = () => {
    setName('');
    setSelectedKey('');
    setCredentialValues({});
    setExpiryValues({});
    setConfigRows(
      existingProvider
        ? Object.entries(existingProvider.config ?? {}).map(([key, value]) => ({
            key,
            value,
          }))
        : [],
    );
    mutation.reset();
    onClose();
  };

  const submit = () => {
    if (anyExpiryInvalid || (!isEdit && !selectedProfile)) {
      return;
    }
    // The fields and the credential-input slot hold values by credential
    // name; the gateway wants each one under the key it stores it at.
    const profileCredentials = selectedProfile?.credentials ?? [];
    const storedKeys = existingProvider?.credentialNames ?? [];
    const credentials: Record<string, string> = {};
    for (const credential of profileCredentials) {
      const value = credentialValues[credential.name];
      if (value) {
        credentials[credentialStorageKey(credential, storedKeys)] = value;
      }
    }
    const config: Record<string, string> = {};
    if (isEdit && existingProvider) {
      for (const key of Object.keys(existingProvider.config ?? {})) {
        config[key] = '';
      }
    }
    for (const row of configRows) {
      if (row.key.trim()) {
        config[row.key.trim()] = row.value;
      }
    }

    if (isEdit && existingProvider) {
      const credentialExpiresAtMs: Record<string, number> = {};
      for (const credential of profileCredentials) {
        const expiresAtMs = parseCredentialExpiry(
          expiryValues[credential.name] ?? '',
        );
        if (expiresAtMs !== undefined) {
          credentialExpiresAtMs[credentialStorageKey(credential, storedKeys)] =
            expiresAtMs;
        }
      }
      updateProvider.mutate(
        {
          name: existingProvider.metadata.name,
          credentials:
            Object.keys(credentials).length > 0 ? credentials : undefined,
          credentialExpiresAtMs:
            Object.keys(credentialExpiresAtMs).length > 0
              ? credentialExpiresAtMs
              : undefined,
          config,
        },
        {
          onSuccess: () => {
            addSuccess('Provider updated');
            onSuccess?.();
            close();
          },
        },
      );
    } else {
      createProvider.mutate(
        {
          name,
          type: selectedProfile?.id ?? '',
          // The gateway looks the type up in the scope the provider names,
          // so the request names the scope the chosen profile lives in.
          profileWorkspace: selectedProfile
            ? profileWorkspaceFor(selectedProfile, workspace)
            : undefined,
          credentials:
            Object.keys(credentials).length > 0 ? credentials : undefined,
          config: Object.keys(config).length > 0 ? config : undefined,
        },
        {
          onSuccess: () => {
            addSuccess('Provider created');
            onSuccess?.();
            close();
          },
        },
      );
    }
  };

  const testIdPrefix = isEdit ? 'edit' : 'create';

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={close}
      aria-label={isEdit ? 'Edit provider' : 'Add provider'}
    >
      <ModalHeader title={isEdit ? 'Edit provider' : 'Add provider'} />
      <ModalBody>
        {profiles.isLoading ? (
          <Spinner size="lg" aria-label="Loading provider profiles" />
        ) : (
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {!isEdit && (
              <>
                <FormGroup label="Name" isRequired fieldId="provider-name">
                  <TextInput
                    id="provider-name"
                    data-testid="provider-name-input"
                    isRequired
                    value={name}
                    onChange={(_event, value) => setName(value)}
                  />
                </FormGroup>
                <FormGroup label="Type" isRequired fieldId="provider-type">
                  <FormSelect
                    id="provider-type"
                    data-testid="provider-type-select"
                    value={selectedKey}
                    onChange={(_event, value) => {
                      setSelectedKey(value);
                      setCredentialValues({});
                    }}
                  >
                    <FormSelectOption
                      value=""
                      label="Select a provider type"
                      isDisabled
                    />
                    {(profiles.data ?? []).map((profile) => (
                      <FormSelectOption
                        key={profileKey(profile)}
                        value={profileKey(profile)}
                        label={
                          isAmbiguousProfile(profiles.data ?? [], profile)
                            ? `${profile.displayName} (${profile.category}, ${profile.scope} profile)`
                            : `${profile.displayName} (${profile.category})`
                        }
                      />
                    ))}
                  </FormSelect>
                  {selectedProfile?.description && (
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {selectedProfile.description}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  )}
                </FormGroup>
              </>
            )}
            {(selectedProfile?.credentials ?? []).map((credential) => (
              <React.Fragment key={credential.name}>
                <FormGroup
                  label={credential.name}
                  isRequired={!isEdit && credential.required}
                  fieldId={`${testIdPrefix}-credential-${credential.name}`}
                >
                  {!isEdit && resolvedCredentialInput ? (
                    resolvedCredentialInput(
                      credential,
                      credentialValues[credential.name] ?? '',
                      (value) =>
                        setCredentialValues((current) => ({
                          ...current,
                          [credential.name]: value,
                        })),
                    )
                  ) : (
                    <TextInput
                      id={`${testIdPrefix}-credential-${credential.name}`}
                      data-testid={`${testIdPrefix}-credential-${credential.name}-input`}
                      type="password"
                      isRequired={!isEdit && credential.required}
                      placeholder={
                        isEdit ? 'Leave blank to keep current value' : undefined
                      }
                      value={credentialValues[credential.name] ?? ''}
                      onChange={(_event, value) =>
                        setCredentialValues((current) => ({
                          ...current,
                          [credential.name]: value,
                        }))
                      }
                    />
                  )}
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {credential.description ||
                          (credential.envVars?.length
                            ? `Injected as ${credential.envVars.join(', ')}`
                            : isEdit
                              ? 'Leave blank to keep existing value'
                              : 'Stored by the gateway; never shown again')}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                {isEdit && (
                  <FormGroup
                    label={`${credential.name} expiry`}
                    fieldId={`credential-expires-${credential.name}`}
                  >
                    <TextInput
                      id={`credential-expires-${credential.name}`}
                      value={expiryValues[credential.name] ?? ''}
                      validated={
                        expiryInvalid(credential.name) ? 'error' : 'default'
                      }
                      onChange={(_event, value) =>
                        setExpiryValues((c) => ({
                          ...c,
                          [credential.name]: value,
                        }))
                      }
                      placeholder="2030-01-01T00:00:00Z or epoch ms (optional)"
                    />
                    <FormHelperText>
                      <HelperText>
                        {expiryInvalid(credential.name) ? (
                          <HelperTextItem variant="error">
                            Enter a future date such as 2030-01-01T00:00:00Z, or
                            a future time in epoch milliseconds.
                          </HelperTextItem>
                        ) : (
                          <HelperTextItem>
                            When this credential expires. Leave empty to keep
                            the current value.
                          </HelperTextItem>
                        )}
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
                )}
              </React.Fragment>
            ))}
            <FormGroup
              label="Configuration"
              fieldId={`${testIdPrefix}-provider-config`}
              role="group"
            >
              <KeyValueEditor
                rows={configRows}
                onChange={setConfigRows}
                testIdPrefix={
                  isEdit ? 'edit-provider-config' : 'provider-config'
                }
                addLabel="Add config entry"
              />
              {!isEdit && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Optional non-secret key/value settings for this provider
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
            {mutation.isError && (
              <Alert
                variant="danger"
                isInline
                title={isEdit ? 'Update failed' : 'Create failed'}
              >
                {(mutation.error as Error).message}
              </Alert>
            )}
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={
            (!isEdit && (!name || !selectedProfile || requiredMissing)) ||
            anyExpiryInvalid ||
            mutation.isPending
          }
          isLoading={mutation.isPending}
          data-testid={
            isEdit ? 'edit-provider-submit' : 'create-provider-submit'
          }
        >
          {isEdit ? 'Save' : 'Add provider'}
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ProviderFormModal;
