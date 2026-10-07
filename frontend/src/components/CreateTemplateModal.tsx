import { useState } from 'react';
import {
  Alert,
  Button,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSection,
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

import { useCreateTemplate } from '../api/templates';
import { useAlerts } from '../app/AlertContext';
import { parseLabels, resolveImage } from '../hooks/useCreateSandboxForm';
import KeyValueEditor from './KeyValueEditor';
import {
  parseDriverConfig,
  parseDurationMs,
  rowsToRecord,
  type KeyValueRow,
} from '../utils/sandboxOptions';
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
  // Advanced options: `sandbox template create --annotation`, `--ready-within`,
  // `--max-burst` and `--driver-config-json`.
  const [annotationRows, setAnnotationRows] = useState<KeyValueRow[]>([]);
  const [readyWithin, setReadyWithin] = useState('');
  const [maxBurst, setMaxBurst] = useState('');
  const [driverConfigText, setDriverConfigText] = useState('');
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);

  const env = parseLabels(envText);
  const labels = parseLabels(labelsText);
  const gpuInvalid = gpuCount !== '' && !/^[0-9]+$/.test(gpuCount);
  const resolvedImage = image ? resolveImage(image) : '';
  const isResolved = Boolean(image) && resolvedImage !== image.trim();
  const { record: annotations, error: annotationsError } =
    rowsToRecord(annotationRows);
  const readyWithinMs = parseDurationMs(readyWithin);
  const readyWithinInvalid = readyWithinMs === null;
  const maxBurstInvalid = maxBurst !== '' && !/^[1-9][0-9]*$/.test(maxBurst);
  const { value: driverConfig, error: driverConfigError } =
    parseDriverConfig(driverConfigText);
  // The section opens by itself around a field that needs correcting.
  const hasAdvancedError =
    Boolean(annotationsError || driverConfigError) ||
    readyWithinInvalid ||
    maxBurstInvalid;
  // The image is not required: a template without one stands for the
  // gateway's default image.
  const isValid =
    Boolean(name) &&
    env !== null &&
    labels !== null &&
    !gpuInvalid &&
    !hasAdvancedError;

  const reset = () => {
    setName('');
    setImage('');
    setEnvText('');
    setGpuCount('');
    setCpu('');
    setMemory('');
    setLabelsText('');
    setAnnotationRows([]);
    setReadyWithin('');
    setMaxBurst('');
    setDriverConfigText('');
    setAdvancedExpanded(false);
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
            ...(Number(gpuCount) > 0
              ? { gpu: { count: Number(gpuCount) } }
              : {}),
          }
        : undefined;
    // Either half of the startup service level can be given without the
    // other, and neither is sent when both are left empty.
    const startup =
      readyWithinMs || maxBurst
        ? {
            ...(readyWithinMs ? { readyWithinMs } : {}),
            ...(maxBurst ? { maxBurst: Number(maxBurst) } : {}),
          }
        : undefined;
    const body: CreateSandboxTemplateRequest = {
      name,
      labels: Object.keys(labels).length > 0 ? labels : undefined,
      annotations:
        Object.keys(annotations).length > 0 ? annotations : undefined,
      spec: {
        // Always sent, as the CLI's `sandbox template create` sends it: the
        // gateway refuses a template without a workload, and takes a
        // workload without an image.
        workload: {
          image: resolveImage(image) || undefined,
          environment: Object.keys(env).length > 0 ? env : undefined,
          resources,
        },
        driverConfig,
        desiredServiceLevel: startup ? { startup } : undefined,
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
          <FormGroup label="Image" fieldId="template-image">
            <TextInput
              id="template-image"
              data-testid="template-image-input"
              value={image}
              onChange={(_event, value) => setImage(value)}
              placeholder="Leave empty for the gateway's default image"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem data-testid="template-image-help">
                  {isResolved
                    ? `Community image — resolves to ${resolvedImage}`
                    : "Optional. A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference. Leaving it empty uses the gateway's default image for every sandbox created from the template."}
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
          <ExpandableSection
            toggleText="Advanced options"
            isExpanded={isAdvancedExpanded || hasAdvancedError}
            onToggle={(_event, expanded) => setAdvancedExpanded(expanded)}
            data-testid="template-advanced-expand"
          >
            <FormSection>
              <FormGroup
                label="Annotations"
                fieldId="template-annotations"
                role="group"
              >
                <KeyValueEditor
                  rows={annotationRows}
                  onChange={setAnnotationRows}
                  testIdPrefix="template-annotation"
                  addLabel="Add annotation"
                  itemLabel="Annotation"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={annotationsError ? 'error' : 'default'}
                      data-testid="template-annotations-help"
                    >
                      {annotationsError ??
                        'Metadata kept with the template. Unlike labels, annotations cannot be filtered on.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup
                label="Startup service level"
                fieldId="template-startup"
                role="group"
              >
                <Grid hasGutter>
                  <GridItem span={6}>
                    <TextInput
                      id="template-ready-within"
                      data-testid="template-ready-within-input"
                      value={readyWithin}
                      onChange={(_event, value) => setReadyWithin(value)}
                      placeholder="Ready within (e.g. 30s, 5m, 1h)"
                      validated={readyWithinInvalid ? 'error' : 'default'}
                      aria-label="Ready within"
                    />
                  </GridItem>
                  <GridItem span={6}>
                    <TextInput
                      id="template-max-burst"
                      data-testid="template-max-burst-input"
                      value={maxBurst}
                      onChange={(_event, value) => setMaxBurst(value)}
                      placeholder="Max burst (e.g. 4)"
                      validated={maxBurstInvalid ? 'error' : 'default'}
                      aria-label="Max burst"
                    />
                  </GridItem>
                </Grid>
                <FormHelperText>
                  <HelperText>
                    {readyWithinInvalid && (
                      <HelperTextItem
                        variant="error"
                        data-testid="template-ready-within-error"
                      >
                        Ready within must be a whole number greater than zero
                        followed by s, m or h
                      </HelperTextItem>
                    )}
                    {maxBurstInvalid && (
                      <HelperTextItem
                        variant="error"
                        data-testid="template-max-burst-error"
                      >
                        Max burst must be a whole number greater than zero
                      </HelperTextItem>
                    )}
                    {!readyWithinInvalid && !maxBurstInvalid && (
                      <HelperTextItem>
                        Both optional. Ready within is the target time for a
                        sandbox from this template to become ready. Max burst is
                        the maximum startup burst associated with the template.
                      </HelperTextItem>
                    )}
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup label="Driver config" fieldId="template-driver-config">
                <TextArea
                  id="template-driver-config"
                  data-testid="template-driver-config-input"
                  value={driverConfigText}
                  onChange={(_event, value) => setDriverConfigText(value)}
                  rows={4}
                  resizeOrientation="vertical"
                  className="pf-v6-u-font-family-monospace"
                  placeholder='{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}'
                  validated={driverConfigError ? 'error' : 'default'}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={driverConfigError ? 'error' : 'default'}
                      data-testid="template-driver-config-help"
                    >
                      {driverConfigError ??
                        'A JSON object keyed by compute driver name, applied to every sandbox created from the template. The gateway refuses it unless its administrator has enabled allow_driver_config.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </FormSection>
          </ExpandableSection>
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
