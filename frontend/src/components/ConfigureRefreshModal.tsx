import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';

import type { ConfigureProviderRefreshRequest, RefreshStrategy } from '../types';

type ConfigureRefreshModalProps = {
  isOpen: boolean;
  credentialNames: string[];
  isSubmitting: boolean;
  error?: string;
  onSubmit: (body: ConfigureProviderRefreshRequest) => void;
  onClose: () => void;
};

const STRATEGIES: { value: RefreshStrategy; label: string }[] = [
  { value: 'oauth2-refresh-token', label: 'OAuth2 Refresh Token' },
  { value: 'oauth2-client-credentials', label: 'OAuth2 Client Credentials' },
  { value: 'google-service-account-jwt', label: 'Google Service Account JWT' },
  { value: 'aws-sts-assume-role', label: 'AWS STS Assume Role' },
  { value: 'static', label: 'Static' },
  { value: 'external', label: 'External' },
];

const ConfigureRefreshModal: React.FC<ConfigureRefreshModalProps> = ({
  isOpen,
  credentialNames,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}) => {
  const [credentialKey, setCredentialKey] = useState('');
  const [strategy, setStrategy] = useState<RefreshStrategy>('oauth2-refresh-token');
  const [materialEntries, setMaterialEntries] = useState<{ key: string; value: string }[]>([]);
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState('');

  const reset = () => {
    setCredentialKey('');
    setStrategy('oauth2-refresh-token');
    setMaterialEntries([]);
    setSecretKeys(new Set());
    setExpiresAt('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const addMaterialEntry = () => {
    setMaterialEntries((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeMaterialEntry = (index: number) => {
    setMaterialEntries((prev) => prev.filter((_, i) => i !== index));
    setSecretKeys((prev) => {
      const next = new Set(prev);
      next.delete(materialEntries[index]?.key);
      return next;
    });
  };

  const updateMaterialKey = (index: number, key: string) => {
    setMaterialEntries((prev) => prev.map((e, i) => (i === index ? { ...e, key } : e)));
  };

  const updateMaterialValue = (index: number, value: string) => {
    setMaterialEntries((prev) => prev.map((e, i) => (i === index ? { ...e, value } : e)));
  };

  const toggleSecretKey = (key: string, checked: boolean) => {
    setSecretKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const material: Record<string, string> = {};
    for (const entry of materialEntries) {
      if (entry.key) {
        material[entry.key] = entry.value;
      }
    }
    const body: ConfigureProviderRefreshRequest = {
      credentialKey,
      strategy,
    };
    if (Object.keys(material).length > 0) {
      body.material = material;
    }
    const secretMaterialKeys = Array.from(secretKeys).filter((k) => k in material);
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
      onClose={close}
      aria-label="Configure credential refresh"
    >
      <ModalHeader title="Configure credential refresh" />
      <ModalBody>
        <FormGroup label="Credential key" isRequired fieldId="refresh-credential-key">
          <FormSelect
            id="refresh-credential-key"
            data-testid="refresh-credential-key"
            value={credentialKey}
            onChange={(_event, value) => setCredentialKey(value)}
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
        </FormGroup>
        <FormGroup label="Material (key/value pairs)" fieldId="refresh-material">
          {materialEntries.map((entry, index) => (
            <div
              key={index}
              style={{ display: 'flex', gap: 'var(--pf-t--global--spacer--sm)', marginBottom: 'var(--pf-t--global--spacer--sm)', alignItems: 'center' }}
            >
              <TextInput
                aria-label={`Material key ${index}`}
                placeholder="Key"
                value={entry.key}
                onChange={(_event, value) => updateMaterialKey(index, value)}
              />
              <TextInput
                aria-label={`Material value ${index}`}
                placeholder="Value"
                type={secretKeys.has(entry.key) ? 'password' : 'text'}
                value={entry.value}
                onChange={(_event, value) => updateMaterialValue(index, value)}
              />
              <Checkbox
                id={`secret-${index}`}
                label="Secret"
                isChecked={secretKeys.has(entry.key)}
                isDisabled={!entry.key}
                onChange={(_event, checked) => toggleSecretKey(entry.key, checked)}
              />
              <Button
                variant="plain"
                aria-label="Remove material entry"
                onClick={() => removeMaterialEntry(index)}
                icon={<MinusCircleIcon />}
              />
            </div>
          ))}
          <Button
            variant="link"
            icon={<PlusCircleIcon />}
            onClick={addMaterialEntry}
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
          <Alert variant="danger" isInline title="Failed to configure refresh" className="pf-v6-u-mt-md">
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
        <Button variant="link" onClick={close} isDisabled={isSubmitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ConfigureRefreshModal;
