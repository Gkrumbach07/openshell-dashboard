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
  const [profileId, setProfileId] = useState('');
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

  const selectedProfile = useMemo(
    () =>
      (profiles.data ?? []).find(
        (profile) =>
          profile.id === (isEdit ? existingProvider?.type : profileId),
      ),
    [profiles.data, isEdit, existingProvider?.type, profileId],
  );

  const requiredMissing =
    !isEdit &&
    (selectedProfile?.credentials ?? [])
      .filter((credential) => credential.required)
      .some((credential) => !credentialValues[credential.name]);

  const close = () => {
    setName('');
    setProfileId('');
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
    const credentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(credentialValues)) {
      if (value) {
        credentials[key] = value;
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
      for (const [key, value] of Object.entries(expiryValues)) {
        if (value.trim()) {
          credentialExpiresAtMs[key] = Number(value.trim());
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
          type: profileId,
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
                    value={profileId}
                    onChange={(_event, value) => {
                      setProfileId(value);
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
                        key={profile.id}
                        value={profile.id}
                        label={`${profile.displayName} (${profile.category})`}
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
                      onChange={(_event, value) =>
                        setExpiryValues((c) => ({
                          ...c,
                          [credential.name]: value,
                        }))
                      }
                      placeholder="RFC3339 or epoch ms (optional, 0 to clear)"
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          When this credential expires. Leave empty to keep
                          current value.
                        </HelperTextItem>
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
            (!isEdit && (!name || !profileId || requiredMissing)) ||
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
