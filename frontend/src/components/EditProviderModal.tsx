import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
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

import { useProviderProfiles, useUpdateProvider } from '../api/providers';
import { useAlerts } from '../app/AlertContext';
import type { Provider } from '../types';

type EditProviderModalProps = {
  workspace: string;
  provider: Provider;
  isOpen: boolean;
  onClose: () => void;
};

const EditProviderModal: React.FC<EditProviderModalProps> = ({
  workspace,
  provider,
  isOpen,
  onClose,
}) => {
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [expiryValues, setExpiryValues] = useState<Record<string, string>>({});
  const [configRows, setConfigRows] = useState<{ key: string; value: string }[]>(
    Object.entries(provider.config ?? {}).map(([key, value]) => ({ key, value })),
  );
  const profiles = useProviderProfiles(workspace);
  const updateProvider = useUpdateProvider(workspace);
  const { addSuccess } = useAlerts();

  const selectedProfile = useMemo(
    () => (profiles.data ?? []).find((profile) => profile.id === provider.type),
    [profiles.data, provider.type],
  );

  const close = () => {
    setCredentialValues({});
    setExpiryValues({});
    setConfigRows(Object.entries(provider.config ?? {}).map(([key, value]) => ({ key, value })));
    updateProvider.reset();
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
    // Send empty values for removed keys so the gateway deletes them
    for (const key of Object.keys(provider.config ?? {})) {
      config[key] = '';
    }
    for (const row of configRows) {
      if (row.key.trim()) {
        config[row.key.trim()] = row.value;
      }
    }
    const credentialExpiresAtMs: Record<string, number> = {};
    for (const [key, value] of Object.entries(expiryValues)) {
      if (value.trim()) {
        credentialExpiresAtMs[key] = Number(value.trim());
      }
    }
    updateProvider.mutate(
      {
        name: provider.metadata.name,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        credentialExpiresAtMs: Object.keys(credentialExpiresAtMs).length > 0 ? credentialExpiresAtMs : undefined,
        config,
      },
      {
        onSuccess: () => {
          addSuccess('Provider updated');
          close();
        },
      },
    );
  };

  return (
    <Modal variant="medium" isOpen={isOpen} onClose={close} aria-label="Edit provider">
      <ModalHeader title="Edit provider" />
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
            {(selectedProfile?.credentials ?? []).map((credential) => (
              <React.Fragment key={credential.name}>
                <FormGroup
                  label={credential.name}
                  fieldId={`edit-credential-${credential.name}`}
                >
                  <TextInput
                    id={`edit-credential-${credential.name}`}
                    data-testid={`edit-credential-${credential.name}-input`}
                    type="password"
                    placeholder="Leave blank to keep current value"
                    value={credentialValues[credential.name] ?? ''}
                    onChange={(_event, value) =>
                      setCredentialValues((current) => ({ ...current, [credential.name]: value }))
                    }
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {credential.description ||
                          (credential.envVars?.length
                            ? `Injected as ${credential.envVars.join(', ')}`
                            : 'Leave blank to keep existing value')}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup label={`${credential.name} expiry`} fieldId={`credential-expires-${credential.name}`}>
                  <TextInput
                    id={`credential-expires-${credential.name}`}
                    value={expiryValues[credential.name] ?? ''}
                    onChange={(_event, value) => setExpiryValues((c) => ({ ...c, [credential.name]: value }))}
                    placeholder="RFC3339 or epoch ms (optional, 0 to clear)"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>When this credential expires. Leave empty to keep current value.</HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              </React.Fragment>
            ))}
            <FormGroup label="Configuration" fieldId="edit-provider-config" role="group">
              <Stack hasGutter>
                {configRows.map((row, index) => (
                  <StackItem key={index}>
                    <Grid hasGutter>
                      <GridItem span={5}>
                        <TextInput
                          id={`edit-provider-config-key-${index}`}
                          data-testid={`edit-provider-config-key-${index}`}
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
                          id={`edit-provider-config-value-${index}`}
                          data-testid={`edit-provider-config-value-${index}`}
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
                          data-testid={`edit-provider-config-remove-${index}`}
                        >
                          Remove
                        </Button>
                      </GridItem>
                    </Grid>
                  </StackItem>
                ))}
              </Stack>
              <Button
                variant="link"
                isInline
                onClick={() => setConfigRows((rows) => [...rows, { key: '', value: '' }])}
                data-testid="edit-provider-config-add"
              >
                Add config entry
              </Button>
            </FormGroup>
            {updateProvider.isError && (
              <Alert variant="danger" isInline title="Update failed">
                {(updateProvider.error as Error).message}
              </Alert>
            )}
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={updateProvider.isPending}
          isLoading={updateProvider.isPending}
          data-testid="edit-provider-submit"
        >
          Save
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default EditProviderModal;
