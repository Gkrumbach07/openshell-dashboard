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
  Grid,
  GridItem,
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
import { useCreateSandbox } from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import { useCreateSandboxForm } from '../hooks/useCreateSandboxForm';
import { policyTemplates } from './policy/policyTemplates';

type CreateSandboxModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
};

const CreateSandboxModal: React.FC<CreateSandboxModalProps> = ({
  workspace,
  isOpen,
  onClose,
}) => {
  const form = useCreateSandboxForm();
  const providers = useProviders(workspace);
  const createSandbox = useCreateSandbox(workspace);
  const { addSuccess } = useAlerts();

  const close = () => {
    form.reset();
    createSandbox.reset();
    onClose();
  };

  const submit = () => {
    const payload = form.buildPayload();
    if (!payload) return;
    createSandbox.mutate(payload, {
      onSuccess: () => {
        addSuccess('Sandbox created');
        close();
      },
    });
  };

  return (
    <Modal
      variant="large"
      isOpen={isOpen}
      onClose={close}
      aria-label="Create sandbox"
    >
      <ModalHeader
        title="Create sandbox"
        description="A sandbox is a secure execution environment. It can be stopped and started, and runs until deleted."
      />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup label="Name" fieldId="sandbox-name">
            <TextInput
              id="sandbox-name"
              data-testid="sandbox-name-input"
              value={form.name}
              onChange={(_event, value) => form.setName(value)}
              placeholder="Leave empty for a generated name"
            />
          </FormGroup>
          <FormGroup label="Image" isRequired fieldId="sandbox-image">
            <TextInput
              id="sandbox-image"
              data-testid="sandbox-image-input"
              isRequired
              value={form.image}
              onChange={(_event, value) => form.setImage(value)}
              placeholder="base, python, ollama — or a full OCI image reference"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {form.isResolved
                    ? `Community image — resolves to ${form.resolvedImage}`
                    : 'A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Labels" fieldId="sandbox-labels">
            <TextInput
              id="sandbox-labels"
              data-testid="sandbox-labels-input"
              value={form.labelsText}
              onChange={(_event, value) => form.setLabelsText(value)}
              placeholder="team=ml, kind=agent"
              validated={form.labels === null ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem
                  variant={form.labels === null ? 'error' : 'default'}
                >
                  {form.labels === null
                    ? 'Labels must be comma-separated key=value pairs'
                    : 'Optional comma-separated key=value pairs, used for filtering'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Providers" fieldId="sandbox-providers" role="group">
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
                  id={`sandbox-provider-${provider.metadata.name}`}
                  data-testid={`sandbox-provider-${provider.metadata.name}`}
                  label={`${provider.metadata.name} (${provider.type})`}
                  isChecked={form.selectedProviders.includes(
                    provider.metadata.name,
                  )}
                  onChange={(_event, checked) =>
                    form.toggleProvider(provider.metadata.name, checked)
                  }
                />
              ))
            )}
          </FormGroup>
          <FormGroup label="Resources" fieldId="sandbox-resources" role="group">
            <Grid hasGutter>
              <GridItem span={4}>
                <TextInput
                  id="sandbox-gpu"
                  data-testid="sandbox-gpu-input"
                  value={form.gpuCount}
                  onChange={(_event, value) => form.setGpuCount(value)}
                  placeholder="GPUs (e.g. 1)"
                  validated={form.gpuInvalid ? 'error' : 'default'}
                  aria-label="GPU count"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="sandbox-cpu"
                  data-testid="sandbox-cpu-input"
                  value={form.cpu}
                  onChange={(_event, value) => form.setCpu(value)}
                  placeholder="CPU limit (e.g. 2, 500m)"
                  aria-label="CPU limit"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="sandbox-memory"
                  data-testid="sandbox-memory-input"
                  value={form.memory}
                  onChange={(_event, value) => form.setMemory(value)}
                  placeholder="Memory limit (e.g. 4Gi)"
                  aria-label="Memory limit"
                />
              </GridItem>
            </Grid>
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={form.gpuInvalid ? 'error' : 'default'}>
                  {form.gpuInvalid
                    ? 'GPU count must be a whole number'
                    : 'All optional. CPU/memory use Kubernetes quantities and apply as limits.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup
            label="Security policy"
            isRequired
            fieldId="sandbox-policy-template"
          >
            <FormSelect
              id="sandbox-policy-template"
              data-testid="sandbox-policy-template-select"
              value={form.templateId}
              onChange={(_event, value) => form.applyTemplate(value)}
            >
              {policyTemplates.map((template) => (
                <FormSelectOption
                  key={template.id}
                  value={template.id}
                  label={template.name}
                />
              ))}
            </FormSelect>
            {form.activeTemplate && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {form.activeTemplate.description}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
          <ExpandableSection
            toggleText="Customize policy (advanced)"
            isExpanded={form.isPolicyExpanded || Boolean(form.policyError)}
            onToggle={(_event, expanded) => form.setPolicyExpanded(expanded)}
            data-testid="sandbox-policy-expand"
          >
            <FormGroup label="Policy JSON" isRequired fieldId="sandbox-policy">
              <TextArea
                id="sandbox-policy"
                data-testid="sandbox-policy-input"
                value={form.policyText}
                onChange={(_event, value) => form.setPolicyText(value)}
                rows={14}
                className="pf-v6-u-font-family-monospace"
                validated={form.policyError ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem
                    variant={form.policyError ? 'error' : 'default'}
                  >
                    {form.policyError
                      ? `Invalid JSON: ${form.policyError}`
                      : 'SandboxPolicy as JSON. Network rules can be edited after create; filesystem, landlock, and process are immutable once created.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </ExpandableSection>
          {createSandbox.isError && (
            <Alert variant="danger" isInline title="Create failed">
              {(createSandbox.error as Error).message}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!form.isValid || createSandbox.isPending}
          isLoading={createSandbox.isPending}
          data-testid="create-sandbox-submit"
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

export default CreateSandboxModal;
