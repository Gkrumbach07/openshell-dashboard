import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Flex,
  FlexItem,
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
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';

import { useMaterialEntries } from '../../hooks/useMaterialEntries';
import type {
  ConfigureProviderRefreshRequest,
  ProviderProfile,
  RefreshStrategy,
} from '../../types';
import { credentialForKey } from '../../utils/providerProfiles';

type ConfigureRefreshModalProps = {
  isOpen: boolean;
  // The credential keys refresh can be configured for (see
  // refreshCredentialKeys).
  credentialNames: string[];
  // The profile the provider resolves to. When it declares a refresh for the
  // chosen credential, the strategy and the material that refresh needs are
  // filled in from it.
  profile?: ProviderProfile;
  isSubmitting: boolean;
  error?: string;
  onSubmit: (body: ConfigureProviderRefreshRequest) => void;
  onClose: () => void;
};

// The strategies the gateway performs itself, which are the ones refresh can
// be configured with: `openshell provider refresh configure --strategy` takes
// these four, and the gateway refuses a static or external strategy here as
// "not gateway-mintable".
const STRATEGIES: { value: RefreshStrategy; label: string }[] = [
  { value: 'oauth2-refresh-token', label: 'OAuth2 Refresh Token' },
  { value: 'oauth2-client-credentials', label: 'OAuth2 Client Credentials' },
  { value: 'google-service-account-jwt', label: 'Google Service Account JWT' },
  { value: 'aws-sts-assume-role', label: 'AWS STS Assume Role' },
];

// The strategy a profile declares, as this form's request spells it.
const declaredStrategy = (strategy: string): RefreshStrategy | undefined =>
  STRATEGIES.find(
    (option) => option.value === strategy.toLowerCase().replace(/_/g, '-'),
  )?.value;

const ConfigureRefreshForm: React.FC<ConfigureRefreshModalProps> = ({
  isOpen,
  credentialNames,
  profile,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}) => {
  const [credentialKey, setCredentialKey] = useState('');
  const [strategy, setStrategy] = useState<RefreshStrategy>(
    'oauth2-refresh-token',
  );
  const [expiresAt, setExpiresAt] = useState('');
  const entries = useMaterialEntries();

  const declared = credentialForKey(profile, credentialKey)?.refresh;
  const describe = (key: string): string | undefined =>
    declared?.material?.find((material) => material.name === key)?.description;

  // Choosing a credential the profile declares a refresh for starts the form
  // from that declaration: its strategy, and a row for each input it needs,
  // marked secret where the profile says so. The gateway checks the request
  // against the same declaration.
  const chooseCredential = (key: string) => {
    setCredentialKey(key);
    const refresh = credentialForKey(profile, key)?.refresh;
    const profileStrategy = refresh && declaredStrategy(refresh.strategy);
    if (!refresh || !profileStrategy) {
      return;
    }
    setStrategy(profileStrategy);
    const material = refresh.material ?? [];
    entries.replace(
      material.map((item) => item.name),
      material.filter((item) => item.secret).map((item) => item.name),
    );
  };

  const handleSubmit = () => {
    const material = entries.toMaterialMap();
    const body: ConfigureProviderRefreshRequest = {
      credentialKey,
      strategy,
    };
    if (Object.keys(material).length > 0) {
      body.material = material;
    }
    const secretMaterialKeys = entries.getSecretMaterialKeys();
    if (secretMaterialKeys.length > 0) {
      body.secretMaterialKeys = secretMaterialKeys;
    }
    if (expiresAt) {
      body.expiresAtMs = new Date(expiresAt).getTime();
    }
    onSubmit(body);
  };

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-label="Configure credential refresh"
    >
      <ModalHeader title="Configure credential refresh" />
      <ModalBody>
        <FormGroup
          label="Credential key"
          isRequired
          fieldId="refresh-credential-key"
        >
          <FormSelect
            id="refresh-credential-key"
            data-testid="refresh-credential-key"
            value={credentialKey}
            onChange={(_event, value) => chooseCredential(value)}
          >
            <FormSelectOption value="" label="Select a credential" isDisabled />
            {credentialNames.map((name) => (
              <FormSelectOption key={name} value={name} label={name} />
            ))}
          </FormSelect>
        </FormGroup>
        <FormGroup label="Strategy" isRequired fieldId="refresh-strategy">
          <FormSelect
            id="refresh-strategy"
            data-testid="refresh-strategy"
            value={strategy}
            onChange={(_event, value) => setStrategy(value as RefreshStrategy)}
          >
            {STRATEGIES.map((s) => (
              <FormSelectOption key={s.value} value={s.value} label={s.label} />
            ))}
          </FormSelect>
          {declared && (
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  The provider profile declares{' '}
                  {declared.strategy.toLowerCase()} for this credential
                  {declared.tokenUrl ? `, at ${declared.tokenUrl}` : ''}.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>
        <FormGroup
          label="Material (key/value pairs)"
          fieldId="refresh-material"
        >
          {entries.materialEntries.map((entry, index) => (
            <Flex
              key={index}
              gap={{ default: 'gapSm' }}
              alignItems={{ default: 'alignItemsCenter' }}
              flexWrap={{ default: 'nowrap' }}
              className="pf-v6-u-mb-sm"
            >
              <FlexItem flex={{ default: 'flex_1' }}>
                <TextInput
                  aria-label={`Material key ${index}`}
                  placeholder="Key"
                  value={entry.key}
                  onChange={(_event, value) => entries.updateKey(index, value)}
                />
              </FlexItem>
              <FlexItem flex={{ default: 'flex_1' }}>
                <TextInput
                  aria-label={`Material value ${index}`}
                  placeholder={describe(entry.key) ?? 'Value'}
                  type={entry.secret ? 'password' : 'text'}
                  value={entry.value}
                  onChange={(_event, value) =>
                    entries.updateValue(index, value)
                  }
                />
              </FlexItem>
              <FlexItem>
                <Checkbox
                  id={`secret-${index}`}
                  label="Secret"
                  isChecked={entry.secret}
                  onChange={(_event, checked) =>
                    entries.toggleSecret(index, checked)
                  }
                />
              </FlexItem>
              <FlexItem>
                <Button
                  variant="plain"
                  aria-label="Remove material entry"
                  onClick={() => entries.removeEntry(index)}
                  icon={<MinusCircleIcon />}
                />
              </FlexItem>
            </Flex>
          ))}
          <Button
            variant="link"
            icon={<PlusCircleIcon />}
            onClick={entries.addEntry}
            data-testid="add-material-entry"
          >
            Add material entry
          </Button>
        </FormGroup>
        <FormGroup label="Expires at (optional)" fieldId="refresh-expires">
          <TextInput
            id="refresh-expires"
            data-testid="refresh-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(_event, value) => setExpiresAt(value)}
          />
        </FormGroup>
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Failed to configure refresh"
            className="pf-v6-u-mt-md"
          >
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          isDisabled={isSubmitting || !credentialKey || !strategy}
          data-testid="configure-refresh-submit"
        >
          Configure
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={isSubmitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// The form is mounted when the dialog opens and unmounted when it closes, so
// nothing typed into it outlives the dialog. What is typed here is refresh
// material: client secrets, private keys, refresh tokens. The dialog is
// closed by its owner when the gateway has accepted the refresh as well as
// by Cancel, and kept mounted it still held all of it the next time it
// opened, the secret values a click on "Secret" away from being shown.
const ConfigureRefreshModal: React.FC<ConfigureRefreshModalProps> = (props) =>
  props.isOpen ? <ConfigureRefreshForm {...props} /> : null;

export default ConfigureRefreshModal;
