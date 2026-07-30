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
import { policyTemplates } from './policyTemplates';
import { parseLabels, resolveImage } from './utils';
import type { SandboxPolicy } from '../types';

type CreateSandboxModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
};

// Create sandbox form. spec.policy is REQUIRED by the gateway — the form
// always submits a policy, seeded from a client-side starter template and
// editable as JSON. (There is no server-side policy library to pick from.)
const CreateSandboxModal: React.FC<CreateSandboxModalProps> = ({ workspace, isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [gpuCount, setGpuCount] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [templateId, setTemplateId] = useState(policyTemplates[0].id);
  const [policyText, setPolicyText] = useState(
    JSON.stringify(policyTemplates[0].policy, null, 2),
  );
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [isPolicyExpanded, setPolicyExpanded] = useState(false);
  const providers = useProviders(workspace);
  const createSandbox = useCreateSandbox(workspace);
  const { addSuccess } = useAlerts();

  const policyError = useMemo(() => {
    try {
      JSON.parse(policyText);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [policyText]);

  const labels = useMemo(() => parseLabels(labelsText), [labelsText]);
  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = policyTemplates.find((candidate) => candidate.id === id);
    if (template) {
      setPolicyText(JSON.stringify(template.policy, null, 2));
    }
  };

  const toggleProvider = (providerName: string, checked: boolean) => {
    setSelectedProviders((current) =>
      checked ? [...current, providerName] : current.filter((item) => item !== providerName),
    );
  };

  const close = () => {
    setName('');
    setImage('');
    setLabelsText('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setSelectedProviders([]);
    setPolicyExpanded(false);
    applyTemplate(policyTemplates[0].id);
    createSandbox.reset();
    onClose();
  };

  const submit = () => {
    if (policyError || labels === null || gpuInvalid) {
      return;
    }
    const policy = JSON.parse(policyText) as SandboxPolicy;
    createSandbox.mutate(
      {
        name: name || undefined,
        image: resolveImage(image),
        policy,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
        providers: selectedProviders.length > 0 ? selectedProviders : undefined,
        gpuCount: gpuCount ? Number(gpuCount) : undefined,
        cpu: cpu || undefined,
        memory: memory || undefined,
      },
      { onSuccess: () => { addSuccess('Sandbox created'); close(); } },
    );
  };

  const activeTemplate = policyTemplates.find((candidate) => candidate.id === templateId);

  return (
    <Modal variant="large" isOpen={isOpen} onClose={close} aria-label="Create sandbox">
      <ModalHeader
        title="Create sandbox"
        description="A sandbox is a secure execution environment. It runs until deleted — there is no stop or suspend."
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
              value={name}
              onChange={(_event, value) => setName(value)}
              placeholder="Leave empty for a generated name"
            />
          </FormGroup>
          <FormGroup label="Image" isRequired fieldId="sandbox-image">
            <TextInput
              id="sandbox-image"
              data-testid="sandbox-image-input"
              isRequired
              value={image}
              onChange={(_event, value) => setImage(value)}
              placeholder="base, python, ollama — or a full OCI image reference"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {image && resolveImage(image) !== image.trim()
                    ? `Community image — resolves to ${resolveImage(image)}`
                    : 'A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Labels" fieldId="sandbox-labels">
            <TextInput
              id="sandbox-labels"
              data-testid="sandbox-labels-input"
              value={labelsText}
              onChange={(_event, value) => setLabelsText(value)}
              placeholder="team=ml, kind=agent"
              validated={labels === null ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={labels === null ? 'error' : 'default'}>
                  {labels === null
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
                  <HelperTextItem>No providers in this workspace yet</HelperTextItem>
                </HelperText>
              </FormHelperText>
            ) : (
              (providers.data ?? []).map((provider) => (
                <Checkbox
                  key={provider.metadata.name}
                  id={`sandbox-provider-${provider.metadata.name}`}
                  data-testid={`sandbox-provider-${provider.metadata.name}`}
                  label={`${provider.metadata.name} (${provider.type})`}
                  isChecked={selectedProviders.includes(provider.metadata.name)}
                  onChange={(_event, checked) => toggleProvider(provider.metadata.name, checked)}
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
                  value={gpuCount}
                  onChange={(_event, value) => setGpuCount(value)}
                  placeholder="GPUs (e.g. 1)"
                  validated={gpuInvalid ? 'error' : 'default'}
                  aria-label="GPU count"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="sandbox-cpu"
                  data-testid="sandbox-cpu-input"
                  value={cpu}
                  onChange={(_event, value) => setCpu(value)}
                  placeholder="CPU limit (e.g. 2, 500m)"
                  aria-label="CPU limit"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="sandbox-memory"
                  data-testid="sandbox-memory-input"
                  value={memory}
                  onChange={(_event, value) => setMemory(value)}
                  placeholder="Memory limit (e.g. 4Gi)"
                  aria-label="Memory limit"
                />
              </GridItem>
            </Grid>
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={gpuInvalid ? 'error' : 'default'}>
                  {gpuInvalid
                    ? 'GPU count must be a whole number'
                    : 'All optional. CPU/memory use Kubernetes quantities and apply as limits.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Security policy" isRequired fieldId="sandbox-policy-template">
            <FormSelect
              id="sandbox-policy-template"
              data-testid="sandbox-policy-template-select"
              value={templateId}
              onChange={(_event, value) => applyTemplate(value)}
            >
              {policyTemplates.map((template) => (
                <FormSelectOption key={template.id} value={template.id} label={template.name} />
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
            data-testid="sandbox-policy-expand"
          >
            <FormGroup label="Policy JSON" isRequired fieldId="sandbox-policy">
              <TextArea
                id="sandbox-policy"
                data-testid="sandbox-policy-input"
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
          isDisabled={
            !image ||
            Boolean(policyError) ||
            labels === null ||
            gpuInvalid ||
            createSandbox.isPending
          }
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
