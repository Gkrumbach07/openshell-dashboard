import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';

import { useCreateProvider, useProviderProfiles } from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import { useSlots } from '../slots';
import type { CredentialInputSlot } from '../types';

type CreateProviderModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  renderCredentialInput?: CredentialInputSlot;
};

// Add Provider form. Provider types are NOT a hardcoded list — the valid
// type slugs come from ListProviderProfiles, and the credential inputs are
// generated from the selected profile's credentials[] schema. Credential
// values are write-only: sent to the gateway, never displayed again.
const CreateProviderModal: React.FC<CreateProviderModalProps> = ({ workspace, isOpen, onClose, onSuccess, renderCredentialInput }) => {
  const slots = useSlots();
  const resolvedCredentialInput = renderCredentialInput ?? slots.credentialInput;
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [configRows, setConfigRows] = useState<{ key: string; value: string }[]>([]);
  const profiles = useProviderProfiles(workspace);
  const createProvider = useCreateProvider(workspace);
  const { addSuccess } = useAlerts();

  const selectedProfile = useMemo(
    () => (profiles.data ?? []).find((profile) => profile.id === profileId),
    [profiles.data, profileId],
  );

  const requiredMissing = (selectedProfile?.credentials ?? [])
    .filter((credential) => credential.required)
    .some((credential) => !credentialValues[credential.name]);

  const close = () => {
    setName('');
    setProfileId('');
    setCredentialValues({});
    setConfigRows([]);
    createProvider.reset();
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
    for (const row of configRows) {
      if (row.key.trim()) {
        config[row.key.trim()] = row.value;
      }
    }
    createProvider.mutate(
      {
        name,
        type: profileId,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
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
  };

  return (
    <Modal variant="medium" isOpen={isOpen} onClose={close} aria-label="Add provider">
      <ModalHeader title="Add provider" />
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
                <FormSelectOption value="" label="Select a provider type" isDisabled />
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
                    <HelperTextItem>{selectedProfile.description}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
            {(selectedProfile?.credentials ?? []).map((credential) => (
              <FormGroup
                key={credential.name}
                label={credential.name}
                isRequired={credential.required}
                fieldId={`credential-${credential.name}`}
              >
                {resolvedCredentialInput ? (
                  resolvedCredentialInput(
                    credential,
                    credentialValues[credential.name] ?? '',
                    (value) =>
                      setCredentialValues((current) => ({ ...current, [credential.name]: value })),
                  )
                ) : (
                  <TextInput
                    id={`credential-${credential.name}`}
                    data-testid={`credential-${credential.name}-input`}
                    type="password"
                    isRequired={credential.required}
                    value={credentialValues[credential.name] ?? ''}
                    onChange={(_event, value) =>
                      setCredentialValues((current) => ({ ...current, [credential.name]: value }))
                    }
                  />
                )}
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {credential.description ||
                        (credential.envVars?.length
                          ? `Injected as ${credential.envVars.join(', ')}`
                          : 'Stored by the gateway; never shown again')}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            ))}
            <FormGroup label="Configuration" fieldId="provider-config" role="group">
              {configRows.length > 0 && (
                <Stack hasGutter>
                  {configRows.map((row, index) => (
                    <StackItem key={index}>
                      <Grid hasGutter>
                        <GridItem span={5}>
                          <TextInput
                            id={`provider-config-key-${index}`}
                            data-testid={`provider-config-key-${index}`}
                            value={row.key}
                            onChange={(_event, value) =>
                              setConfigRows((rows) =>
                                rows.map((r, i) => (i === index ? { ...r, key: value } : r)),
                              )
                            }
                            placeholder="key"
                            aria-label="Config key"
                          />
                        </GridItem>
                        <GridItem span={5}>
                          <TextInput
                            id={`provider-config-value-${index}`}
                            data-testid={`provider-config-value-${index}`}
                            value={row.value}
                            onChange={(_event, value) =>
                              setConfigRows((rows) =>
                                rows.map((r, i) => (i === index ? { ...r, value } : r)),
                              )
                            }
                            placeholder="value"
                            aria-label="Config value"
                          />
                        </GridItem>
                        <GridItem span={2}>
                          <Button
                            variant="link"
                            onClick={() => setConfigRows((rows) => rows.filter((_, i) => i !== index))}
                            data-testid={`provider-config-remove-${index}`}
                          >
                            Remove
                          </Button>
                        </GridItem>
                      </Grid>
                    </StackItem>
                  ))}
                </Stack>
              )}
              <Button
                variant="link"
                isInline
                onClick={() => setConfigRows((rows) => [...rows, { key: '', value: '' }])}
                data-testid="provider-config-add"
              >
                Add config entry
              </Button>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Optional non-secret key/value settings for this provider
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            {createProvider.isError && (
              <Alert variant="danger" isInline title="Create failed">
                {(createProvider.error as Error).message}
              </Alert>
            )}
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!name || !profileId || requiredMissing || createProvider.isPending}
          isLoading={createProvider.isPending}
          data-testid="create-provider-submit"
        >
          Add provider
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateProviderModal;
