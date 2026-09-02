import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  ExpandableSection,
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
  TextArea,
  TextInput,
} from '@patternfly/react-core';

import { useProviders } from '../api/providers';
import { useCreateSandboxFromTemplate } from '../api/templates';
import { useAlerts } from '../app/AlertContext';
import { useJsonValidation } from '../hooks/useJsonValidation';
import { policyTemplates } from './policy/policyTemplates';
import type { SandboxPolicy } from '../types';

type CreateSandboxFromTemplateModalProps = {
  workspace: string;
  templateName: string;
  isOpen: boolean;
  onClose: () => void;
};

const CreateSandboxFromTemplateModal: React.FC<
  CreateSandboxFromTemplateModalProps
> = ({ workspace, templateName, isOpen, onClose }) => {
  const providers = useProviders(workspace);
  const createFromTemplate = useCreateSandboxFromTemplate(workspace);
  const { addSuccess } = useAlerts();
  const [name, setName] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [policyTemplateId, setPolicyTemplateId] = useState(
    policyTemplates[0].id,
  );
  const [policyText, setPolicyText] = useState(
    JSON.stringify(policyTemplates[0].policy, null, 2),
  );
  const [isPolicyExpanded, setPolicyExpanded] = useState(false);

  const { error: policyError, parsed: parsedPolicy } =
    useJsonValidation(policyText);
  const activeTemplate = useMemo(
    () =>
      policyTemplates.find((candidate) => candidate.id === policyTemplateId),
    [policyTemplateId],
  );
  const isValid = !policyError && Boolean(parsedPolicy);

  const applyPolicyTemplate = (id: string) => {
    setPolicyTemplateId(id);
    const template = policyTemplates.find((candidate) => candidate.id === id);
    if (template) {
      setPolicyText(JSON.stringify(template.policy, null, 2));
    }
  };

  const toggleProvider = (providerName: string, checked: boolean) => {
    setSelectedProviders((current) =>
      checked
        ? [...current, providerName]
        : current.filter((item) => item !== providerName),
    );
  };

  const reset = () => {
    setName('');
    setSelectedProviders([]);
    setPolicyExpanded(false);
    applyPolicyTemplate(policyTemplates[0].id);
  };

  const close = () => {
    reset();
    createFromTemplate.reset();
    onClose();
  };

  const submit = () => {
    if (!isValid || !parsedPolicy) {
      return;
    }
    createFromTemplate.mutate(
      {
        name: name || undefined,
        templateName,
        providers: selectedProviders.length > 0 ? selectedProviders : undefined,
        policy: parsedPolicy as SandboxPolicy,
      },
      {
        onSuccess: () => {
          addSuccess(`Sandbox created from template "${templateName}"`);
          close();
        },
      },
    );
  };

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={close}
      aria-label="Create sandbox from template"
    >
      <ModalHeader
        title={`Create sandbox from "${templateName}"`}
        description="The image, environment, and resources come from the template. Supply only a security policy and any providers to attach."
      />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup label="Name" fieldId="from-template-name">
            <TextInput
              id="from-template-name"
              data-testid="from-template-name-input"
              value={name}
              onChange={(_event, value) => setName(value)}
              placeholder="Leave empty for a generated name"
            />
          </FormGroup>
          <FormGroup
            label="Providers"
            fieldId="from-template-providers"
            role="group"
          >
            {(providers.data ?? []).length === 0 ? (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    No providers in this workspace yet
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            ) : (
              (providers.data ?? []).map((provider) => (
                <Checkbox
                  key={provider.metadata.name}
                  id={`from-template-provider-${provider.metadata.name}`}
                  data-testid={`from-template-provider-${provider.metadata.name}`}
                  label={`${provider.metadata.name} (${provider.type})`}
                  isChecked={selectedProviders.includes(provider.metadata.name)}
                  onChange={(_event, checked) =>
                    toggleProvider(provider.metadata.name, checked)
                  }
                />
              ))
            )}
          </FormGroup>
          <FormGroup
            label="Security policy"
            isRequired
            fieldId="from-template-policy-template"
          >
            <FormSelect
              id="from-template-policy-template"
              data-testid="from-template-policy-template-select"
              value={policyTemplateId}
              onChange={(_event, value) => applyPolicyTemplate(value)}
            >
              {policyTemplates.map((template) => (
                <FormSelectOption
                  key={template.id}
                  value={template.id}
                  label={template.name}
                />
              ))}
            </FormSelect>
            {activeTemplate && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>{activeTemplate.description}</HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
          <ExpandableSection
            toggleText="Customize policy (advanced)"
            isExpanded={isPolicyExpanded || Boolean(policyError)}
            onToggle={(_event, expanded) => setPolicyExpanded(expanded)}
            data-testid="from-template-policy-expand"
          >
            <FormGroup
              label="Policy JSON"
              isRequired
              fieldId="from-template-policy"
            >
              <TextArea
                id="from-template-policy"
                data-testid="from-template-policy-input"
                value={policyText}
                onChange={(_event, value) => setPolicyText(value)}
                rows={14}
                className="pf-v6-u-font-family-monospace"
                validated={policyError ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={policyError ? 'error' : 'default'}>
                    {policyError
                      ? `Invalid JSON: ${policyError}`
                      : 'SandboxPolicy as JSON. Network rules can be edited after create; filesystem, landlock, and process are immutable once created.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </ExpandableSection>
          {createFromTemplate.isError && (
            <Alert variant="danger" isInline title="Create failed">
              {(createFromTemplate.error as Error).message}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!isValid || createFromTemplate.isPending}
          isLoading={createFromTemplate.isPending}
          data-testid="create-from-template-submit"
        >
          Create
        </Button>
        <Button variant="link" onClick={close}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateSandboxFromTemplateModal;
