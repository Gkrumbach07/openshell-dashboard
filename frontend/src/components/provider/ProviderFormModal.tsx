import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Content,
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
  useProviders,
  useUpdateProvider,
} from '../../api/providers';
import { useAlerts } from '../../app/AlertContext';
import { useSlots } from '../../slots';
import KeyValueEditor from '../KeyValueEditor';
import type {
  CredentialInputSlot,
  ProfileCredential,
  Provider,
} from '../../types';
import {
  acceptedCredentialKeys,
  credentialStorageKey,
  parseCredentialExpiry,
} from '../../utils/providerCredentials';
import {
  configChanges,
  configFromRows,
  configRowsOf,
  uniqueProviderName,
} from '../../utils/providerForm';
import {
  allowsRuntimeProviderCredentials,
  isAmbiguousProfile,
  isRuntimeResolvable,
  profileForProvider,
  profileKey,
  profileWorkspaceFor,
  requiredStaticCredentials,
} from '../../utils/providerProfiles';

type ProviderFormModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  renderCredentialInput?: CredentialInputSlot;
  // The credential keys a refresh the gateway performs manages on the
  // provider being edited (see refreshManagedKeys). The gateway refuses a
  // provider update that writes one of them, so the form offers no value for
  // those credentials. Leave it out where the refresh status is not known:
  // every credential is then offered and the gateway has the last word.
  refreshManagedKeys?: string[];
} & (
  | { mode: 'create'; provider?: undefined }
  | { mode: 'edit'; provider: Provider }
);

// One credential the form takes a value for. For a provider whose type
// resolves to a profile it is a credential the profile declares, known by its
// name. For one that resolves to none it is a key the provider already holds.
type CredentialField = {
  id: string;
  credential?: ProfileCredential;
  // The keys the value may be stored under.
  keys: string[];
};

const ProviderForm: React.FC<ProviderFormModalProps> = ({
  workspace,
  isOpen,
  onClose,
  onSuccess,
  renderCredentialInput,
  refreshManagedKeys,
  ...modeProps
}) => {
  const isEdit = modeProps.mode === 'edit';
  const existingProvider = isEdit ? modeProps.provider : undefined;

  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const [name, setName] = useState('');
  // The name the form last filled in by itself. While the field still holds
  // it, choosing another type fills in that type's name.
  const [generatedName, setGeneratedName] = useState('');
  // The chosen profile, by profileKey: one id can be listed in two scopes.
  const [selectedKey, setSelectedKey] = useState('');
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({});
  // The key chosen for a credential that can be stored under several.
  const [credentialKeys, setCredentialKeys] = useState<Record<string, string>>(
    {},
  );
  const [runtimeCredentials, setRuntimeCredentials] = useState(false);
  const [expiryValues, setExpiryValues] = useState<Record<string, string>>({});
  // The configuration as it was when the form opened. The provider can be
  // read again while the form is open, by the page's own polling or after a
  // change made elsewhere, and an edit is what was changed here since it
  // opened: see configChanges.
  const [originalConfig] = useState<Record<string, string>>(
    () => existingProvider?.config ?? {},
  );
  const [configRows, setConfigRows] = useState(() =>
    configRowsOf(originalConfig),
  );
  const profiles = useProviderProfiles(workspace);
  const providers = useProviders(workspace);
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

  const storedKeys = useMemo(
    () => existingProvider?.credentialNames ?? [],
    [existingProvider],
  );

  // A provider whose type resolves to no profile cannot be told which
  // credentials it takes. The gateway still takes a new value for one it
  // holds, so those are the fields: the TUI's update form does the same with
  // the provider's stored key.
  const fields = useMemo<CredentialField[]>(() => {
    if (selectedProfile) {
      return selectedProfile.credentials.map((credential) => ({
        id: credential.name,
        credential,
        keys: acceptedCredentialKeys(credential),
      }));
    }
    return isEdit ? storedKeys.map((key) => ({ id: key, keys: [key] })) : [];
  }, [selectedProfile, isEdit, storedKeys]);

  // The key a field's value goes under: the one that was chosen, or else the
  // one the provider already holds the credential under, or else the first.
  const storageKey = (field: CredentialField): string =>
    credentialKeys[field.id] ??
    (field.credential
      ? credentialStorageKey(field.credential, storedKeys)
      : field.keys[0]);

  // A provider can be created with no stored credentials when everything its
  // profile requires is resolved at runtime: the CLI's --runtime-credentials.
  // The choice is offered for exactly the profiles the CLI accepts the flag
  // for, and holds for the profile it was made on.
  const offersRuntimeCredentials =
    !isEdit &&
    !!selectedProfile &&
    allowsRuntimeProviderCredentials(selectedProfile);
  const useRuntimeCredentials = offersRuntimeCredentials && runtimeCredentials;

  // What has to be typed before the gateway takes the provider: a value for
  // each required credential that nothing resolves at runtime. A required
  // credential that is granted or minted needs none.
  const requiredMissing =
    !isEdit &&
    !!selectedProfile &&
    requiredStaticCredentials(selectedProfile).some(
      (credential) => !credentialValues[credential.name],
    );
  const resolvedAtRuntime = (credential: ProfileCredential): boolean =>
    !!selectedProfile && isRuntimeResolvable(selectedProfile, credential);
  const needsValue = (field: CredentialField): boolean =>
    !isEdit &&
    !!field.credential &&
    field.credential.required &&
    !resolvedAtRuntime(field.credential);

  // A credential a refresh the gateway performs manages takes no value from
  // a provider update: the gateway refuses the whole update. It counts as
  // managed under any key it may be stored at, so that a second copy is not
  // written beside the one the refresh keeps.
  const isRefreshManaged = (field: CredentialField): boolean =>
    isEdit && field.keys.some((key) => refreshManagedKeys?.includes(key));

  // The value that will be sent for a field, if any. With runtime credentials
  // none is stored, whatever was typed before the choice was made.
  const valueOf = (field: CredentialField): string =>
    useRuntimeCredentials || isRefreshManaged(field)
      ? ''
      : (credentialValues[field.id] ?? '');

  // An expiry belongs to a credential the provider holds. It can be set on
  // one it holds already, under the key it is held at, or on one this same
  // update gives a value to. Sent for anything else it would be the expiry
  // of a credential that is not there.
  const takesExpiry = (field: CredentialField): boolean =>
    isEdit && (storedKeys.includes(storageKey(field)) || valueOf(field) !== '');

  // An expiry that is not a time still to come is never sent: the gateway
  // would take the credential as expired and switch it off.
  const expiryInvalid = (field: CredentialField): boolean =>
    takesExpiry(field) &&
    Number.isNaN(parseCredentialExpiry(expiryValues[field.id] ?? ''));
  const anyExpiryInvalid = fields.some(expiryInvalid);

  // The fields and the credential-input slot hold values by credential name;
  // the gateway wants each one under the key it stores it at. A key is the
  // name of an environment variable or of a credential, and every map below
  // is built from entries, so that no name is taken for anything else.
  const credentials: Record<string, string> = Object.fromEntries(
    fields
      .filter((field) => valueOf(field) !== '')
      .map((field) => [storageKey(field), valueOf(field)]),
  );
  const credentialExpiresAtMs: Record<string, number> = Object.fromEntries(
    fields.filter(takesExpiry).flatMap((field): [string, number][] => {
      const expiresAtMs = parseCredentialExpiry(expiryValues[field.id] ?? '');
      return expiresAtMs !== undefined && !Number.isNaN(expiresAtMs)
        ? [[storageKey(field), expiresAtMs]]
        : [];
    }),
  );
  // A new provider gets the configuration that was typed. An edit sends the
  // keys that were changed and removed, and no others: the gateway merges an
  // update into what it has, so a key that is not sent keeps whatever value
  // it has by now.
  const config: Record<string, string> = isEdit
    ? configChanges(originalConfig, configRows)
    : configFromRows(configRows);

  // Why there is no provider type to choose, when there is none. A provider
  // is created from a provider profile, and a gateway serves only the
  // profiles that were imported into it, so a new one has none. Profiles read
  // earlier still stand when reading them again fails.
  const profilesUnavailable = profiles.isError && profiles.data === undefined;
  const noProfiles = !profilesUnavailable && (profiles.data ?? []).length === 0;
  const orUndefined = <T,>(map: Record<string, T>) =>
    Object.keys(map).length > 0 ? map : undefined;

  // An edit that changes nothing is not sent. The gateway would take it, and
  // write the provider again as it is.
  const nothingToSave =
    isEdit &&
    !orUndefined(credentials) &&
    !orUndefined(credentialExpiresAtMs) &&
    !orUndefined(config);

  const close = () => {
    mutation.reset();
    onClose();
  };

  const submit = () => {
    if (anyExpiryInvalid || nothingToSave || (!isEdit && !selectedProfile)) {
      return;
    }
    if (isEdit && existingProvider) {
      updateProvider.mutate(
        {
          name: existingProvider.metadata.name,
          credentials: orUndefined(credentials),
          credentialExpiresAtMs: orUndefined(credentialExpiresAtMs),
          config: orUndefined(config),
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
          credentials: orUndefined(credentials),
          config: orUndefined(config),
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

  // Choosing a type fills in a name no provider in the workspace has, as the
  // TUI does, unless a name was typed: "openai", then "openai-1". The gateway
  // has the last word on whether it is free.
  const selectProfile = (key: string) => {
    setSelectedKey(key);
    setCredentialValues({});
    setCredentialKeys({});
    setRuntimeCredentials(false);
    const chosen = (profiles.data ?? []).find(
      (profile) => profileKey(profile) === key,
    );
    if (chosen && (name === '' || name === generatedName)) {
      const generated = uniqueProviderName(
        chosen.id,
        (providers.data ?? []).map((provider) => provider.metadata.name),
      );
      setName(generated);
      setGeneratedName(generated);
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
            {!isEdit && profilesUnavailable && (
              <Alert
                variant="danger"
                isInline
                title="Provider profiles could not be loaded"
                data-testid="create-provider-profiles-error"
                actionLinks={
                  <Button
                    variant="link"
                    isInline
                    onClick={() => profiles.refetch()}
                  >
                    Retry
                  </Button>
                }
              >
                {(profiles.error as Error | null)?.message} A provider is
                created from a provider profile, so there is no type to choose
                until they are.
              </Alert>
            )}
            {!isEdit && noProfiles && (
              <Alert
                variant="info"
                isInline
                title="No provider profiles"
                data-testid="create-provider-no-profiles"
              >
                A provider is created from a provider profile, and this
                workspace sees none. A gateway serves only the profiles that
                were imported into it. Import one first, on the Profiles tab of
                the workspace or with{' '}
                <code>openshell provider profile import</code>, and it will be
                offered here as a type.
              </Alert>
            )}
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
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        Choosing a type fills in a name that is free in this
                        workspace. It can be changed.
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup label="Type" isRequired fieldId="provider-type">
                  <FormSelect
                    id="provider-type"
                    data-testid="provider-type-select"
                    value={selectedKey}
                    onChange={(_event, value) => selectProfile(value)}
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
                {offersRuntimeCredentials && (
                  <FormGroup fieldId="provider-runtime-credentials">
                    <Checkbox
                      id="provider-runtime-credentials"
                      data-testid="provider-runtime-credentials"
                      label="Runtime credentials"
                      description="Create the provider with no stored credentials. Everything this type requires is resolved at runtime: obtained through a token grant, or minted by the gateway once refresh is configured for the provider."
                      isChecked={runtimeCredentials}
                      onChange={(_event, checked) =>
                        setRuntimeCredentials(checked)
                      }
                    />
                  </FormGroup>
                )}
              </>
            )}
            {isEdit && !selectedProfile && existingProvider && (
              <Alert
                variant="warning"
                isInline
                title={
                  profilesUnavailable
                    ? 'Provider profiles could not be loaded'
                    : `No provider profile matches the type "${existingProvider.type}" in the scope this provider names`
                }
                data-testid="edit-provider-unprofiled"
              >
                Without its profile there is no saying which credentials this
                provider takes. A new value can be given to the credentials it
                already holds
                {storedKeys.length === 0 ? ', and it holds none.' : '.'}
              </Alert>
            )}
            {(useRuntimeCredentials ? [] : fields).map((field) => (
              <React.Fragment key={field.id}>
                <FormGroup
                  label={field.id}
                  isRequired={needsValue(field)}
                  fieldId={`${testIdPrefix}-credential-${field.id}`}
                >
                  {isRefreshManaged(field) ? (
                    <Content
                      component="p"
                      data-testid={`${testIdPrefix}-credential-${field.id}-managed`}
                    >
                      Managed by credential refresh. The gateway keeps its value
                      up to date and does not take one from here: use Rotate now
                      or Configure refresh on the provider page.
                    </Content>
                  ) : !isEdit && resolvedCredentialInput && field.credential ? (
                    resolvedCredentialInput(
                      field.credential,
                      credentialValues[field.id] ?? '',
                      (value) =>
                        setCredentialValues((current) => ({
                          ...current,
                          [field.id]: value,
                        })),
                    )
                  ) : (
                    <TextInput
                      id={`${testIdPrefix}-credential-${field.id}`}
                      data-testid={`${testIdPrefix}-credential-${field.id}-input`}
                      type="password"
                      isRequired={needsValue(field)}
                      placeholder={
                        isEdit ? 'Leave blank to keep current value' : undefined
                      }
                      value={credentialValues[field.id] ?? ''}
                      onChange={(_event, value) =>
                        setCredentialValues((current) => ({
                          ...current,
                          [field.id]: value,
                        }))
                      }
                    />
                  )}
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {field.credential?.description ||
                          (field.credential?.envVars?.length
                            ? `Injected as ${field.credential.envVars.join(', ')}`
                            : isRefreshManaged(field)
                              ? 'Kept by the gateway'
                              : isEdit
                                ? 'Leave blank to keep existing value'
                                : 'Stored by the gateway; never shown again')}
                      </HelperTextItem>
                      {!isEdit &&
                        field.credential &&
                        resolvedAtRuntime(field.credential) && (
                          <HelperTextItem>
                            Resolved at runtime. Leave empty unless there is a
                            value to start with.
                          </HelperTextItem>
                        )}
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                {field.keys.length > 1 && !isRefreshManaged(field) && (
                  <FormGroup
                    label={`Store ${field.id} as`}
                    fieldId={`${testIdPrefix}-credential-${field.id}-key`}
                  >
                    <FormSelect
                      id={`${testIdPrefix}-credential-${field.id}-key`}
                      data-testid={`${testIdPrefix}-credential-${field.id}-key`}
                      value={storageKey(field)}
                      onChange={(_event, value) =>
                        setCredentialKeys((current) => ({
                          ...current,
                          [field.id]: value,
                        }))
                      }
                    >
                      {field.keys.map((key) => (
                        <FormSelectOption
                          key={key}
                          value={key}
                          label={
                            storedKeys.includes(key) ? `${key} (held)` : key
                          }
                        />
                      ))}
                    </FormSelect>
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          The profile accepts this credential under any of these
                          keys. The value is stored under the one chosen here.
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
                )}
                {takesExpiry(field) && (
                  <FormGroup
                    label={`${field.id} expiry`}
                    fieldId={`credential-expires-${field.id}`}
                  >
                    <TextInput
                      id={`credential-expires-${field.id}`}
                      value={expiryValues[field.id] ?? ''}
                      validated={expiryInvalid(field) ? 'error' : 'default'}
                      onChange={(_event, value) =>
                        setExpiryValues((c) => ({
                          ...c,
                          [field.id]: value,
                        }))
                      }
                      placeholder="2030-01-01T00:00:00Z or epoch ms (optional)"
                    />
                    <FormHelperText>
                      <HelperText>
                        {expiryInvalid(field) ? (
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
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {isEdit
                      ? 'Only the entries changed or removed here are saved. An entry left as it is keeps its current value.'
                      : 'Optional non-secret key/value settings for this provider'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
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
            nothingToSave ||
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

// The form is mounted when the dialog opens and unmounted when it closes, so
// each time it opens it starts from the provider as it is then. Kept mounted,
// it held the configuration of the provider it was first given, and an edit
// wrote that back.
const ProviderFormModal: React.FC<ProviderFormModalProps> = (props) =>
  props.isOpen ? <ProviderForm {...props} /> : null;

export default ProviderFormModal;
