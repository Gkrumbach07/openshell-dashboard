import { useState } from 'react';
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
  TextInput,
} from '@patternfly/react-core';

import { useCreateTemplate } from '../api/templates';
import { useAlerts } from '../app/AlertContext';
import { parseLabels, resolveImage } from '../hooks/useCreateSandboxForm';
import type { CreateSandboxTemplateRequest } from '../types';

type CreateTemplateModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
};

const CreateTemplateModal: React.FC<CreateTemplateModalProps> = ({
  workspace,
  isOpen,
  onClose,
}) => {
  const createTemplate = useCreateTemplate(workspace);
  const { addSuccess } = useAlerts();
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [envText, setEnvText] = useState('');
  const [gpuCount, setGpuCount] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [labelsText, setLabelsText] = useState('');

  const env = parseLabels(envText);
  const labels = parseLabels(labelsText);
  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);
  const resolvedImage = image ? resolveImage(image) : '';
  const isResolved = Boolean(image) && resolvedImage !== image.trim();
  const isValid =
    Boolean(image) && env !== null && labels !== null && !gpuInvalid;

  const reset = () => {
    setName('');
    setImage('');
    setEnvText('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setLabelsText('');
  };

  const close = () => {
    reset();
    createTemplate.reset();
    onClose();
  };

  const submit = () => {
    if (!isValid || env === null || labels === null) {
      return;
    }
    const resources =
      gpuCount || cpu || memory
        ? {
            ...(cpu ? { cpu } : {}),
            ...(memory ? { memory } : {}),
            ...(gpuCount ? { gpu: { count: Number(gpuCount) } } : {}),
          }
        : undefined;
    const body: CreateSandboxTemplateRequest = {
      name,
      labels: Object.keys(labels).length > 0 ? labels : undefined,
      spec: {
        workload: {
          image: resolveImage(image),
          environment: Object.keys(env).length > 0 ? env : undefined,
          resources,
        },
      },
    };
    createTemplate.mutate(body, {
      onSuccess: () => {
        addSuccess(`Template "${name}" created`);
        close();
      },
    });
  };

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={close}
      aria-label="Create template"
    >
      <ModalHeader
        title="Create template"
        description="A reusable workload template pins an image, environment, and resources. Sandboxes are created from it while supplying only policy and providers."
      />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup label="Name" isRequired fieldId="template-name">
            <TextInput
              id="template-name"
              data-testid="template-name-input"
              isRequired
              value={name}
              onChange={(_event, value) => setName(value)}
              placeholder="claude-harness"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  A DNS-1123 label (lowercase letters, digits, and hyphens).
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Image" isRequired fieldId="template-image">
            <TextInput
              id="template-image"
              data-testid="template-image-input"
              isRequired
              value={image}
              onChange={(_event, value) => setImage(value)}
              placeholder="base, python, ollama — or a full OCI image reference"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {isResolved
                    ? `Community image — resolves to ${resolvedImage}`
                    : 'A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Environment" fieldId="template-env">
            <TextInput
              id="template-env"
              data-testid="template-env-input"
              value={envText}
              onChange={(_event, value) => setEnvText(value)}
              placeholder="HARNESS=claude, LOG_LEVEL=info"
              validated={env === null ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={env === null ? 'error' : 'default'}>
                  {env === null
                    ? 'Environment must be comma-separated key=value pairs'
                    : 'Optional comma-separated key=value pairs baked into the template'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup
            label="Resources"
            fieldId="template-resources"
            role="group"
          >
            <Grid hasGutter>
              <GridItem span={4}>
                <TextInput
                  id="template-gpu"
                  data-testid="template-gpu-input"
                  value={gpuCount}
                  onChange={(_event, value) => setGpuCount(value)}
                  placeholder="GPUs (e.g. 1)"
                  validated={gpuInvalid ? 'error' : 'default'}
                  aria-label="GPU count"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="template-cpu"
                  data-testid="template-cpu-input"
                  value={cpu}
                  onChange={(_event, value) => setCpu(value)}
                  placeholder="CPU (e.g. 2, 500m)"
                  aria-label="CPU"
                />
              </GridItem>
              <GridItem span={4}>
                <TextInput
                  id="template-memory"
                  data-testid="template-memory-input"
                  value={memory}
                  onChange={(_event, value) => setMemory(value)}
                  placeholder="Memory (e.g. 4Gi)"
                  aria-label="Memory"
                />
              </GridItem>
            </Grid>
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={gpuInvalid ? 'error' : 'default'}>
                  {gpuInvalid
                    ? 'GPU count must be a whole number'
                    : 'All optional. CPU and memory use Kubernetes quantities.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Labels" fieldId="template-labels">
            <TextInput
              id="template-labels"
              data-testid="template-labels-input"
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
          {createTemplate.isError && (
            <Alert variant="danger" isInline title="Create failed">
              {(createTemplate.error as Error).message}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={!isValid || createTemplate.isPending}
          isLoading={createTemplate.isPending}
          data-testid="create-template-submit"
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

export default CreateTemplateModal;
