import {
  Alert,
  Button,
  Checkbox,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSection,
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
import { useApplyApprovalMode } from '../api/sandboxSettings';
import { useCreateSandbox } from '../api/sandboxes';
import { useAlerts } from '../app/AlertContext';
import { useCreateSandboxForm } from '../hooks/useCreateSandboxForm';
import KeyValueEditor from './KeyValueEditor';
import { policyTemplates } from './policy/policyTemplates';
import PolicyTextField from './policy/PolicyTextField';
import ApprovalModeFailureAlert from './sandbox/ApprovalModeFailureAlert';
import SandboxLaunchFields from './sandbox/SandboxLaunchFields';

type CreateSandboxModalProps = {
  workspace: string;
  isOpen: boolean;
  onClose: () => void;
};

// The levels the sandbox supervisor logs at. Empty leaves the choice to the
// gateway.
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];

const CreateSandboxModal: React.FC<CreateSandboxModalProps> = ({
  workspace,
  isOpen,
  onClose,
}) => {
  const form = useCreateSandboxForm();
  const providers = useProviders(workspace);
  const createSandbox = useCreateSandbox(workspace);
  const approvalMode = useApplyApprovalMode(workspace);
  const { addSuccess } = useAlerts();

  const close = () => {
    form.reset();
    createSandbox.reset();
    approvalMode.reset();
    onClose();
  };

  const submit = () => {
    const payload = form.buildPayload();
    if (!payload) return;
    const mode = form.launch.approvalMode;
    createSandbox.mutate(payload, {
      onSuccess: async (sandbox) => {
        // The approval mode is a setting of the sandbox, written once the
        // sandbox exists. If that fails the sandbox stays and the modal says
        // so instead of closing.
        if (await approvalMode.apply(sandbox, mode)) {
          addSuccess('Sandbox created');
          close();
        }
      },
    });
  };

  if (approvalMode.failure) {
    return (
      <Modal
        variant="large"
        isOpen={isOpen}
        onClose={close}
        aria-label="Create sandbox"
      >
        <ModalHeader title="Create sandbox" />
        <ModalBody>
          <ApprovalModeFailureAlert failure={approvalMode.failure} />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={close}
            data-testid="create-sandbox-done"
          >
            Close
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // While the create is in flight the form cannot be closed. Closing it
  // lets go of the request, and what follows a create that succeeds (the
  // approval mode, which is written once the sandbox exists) would then never
  // run: the sandbox would be created without it and nothing would say so.
  const isBusy = createSandbox.isPending || approvalMode.isApplying;

  return (
    <Modal
      variant="large"
      isOpen={isOpen}
      onClose={isBusy ? undefined : close}
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
          <FormGroup label="Image" fieldId="sandbox-image">
            <TextInput
              id="sandbox-image"
              data-testid="sandbox-image-input"
              value={form.image}
              onChange={(_event, value) => form.setImage(value)}
              placeholder="Leave empty for the gateway's default image"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem data-testid="sandbox-image-help">
                  {form.isResolved
                    ? `Community image — resolves to ${form.resolvedImage}`
                    : "Optional. A community sandbox name (base, python, ollama, …) or a fully-qualified OCI image reference. Leaving it empty uses the gateway's default image."}
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
            <PolicyTextField
              id="sandbox-policy"
              data-testid="sandbox-policy-input"
              value={form.policyText}
              onChange={form.setPolicyText}
              error={form.policyError}
            />
          </ExpandableSection>
          <ExpandableSection
            toggleText="Advanced options"
            isExpanded={form.isAdvancedExpanded || form.hasAdvancedError}
            onToggle={(_event, expanded) => form.setAdvancedExpanded(expanded)}
            data-testid="sandbox-advanced-expand"
          >
            <FormSection>
              <FormGroup
                label="Environment variables"
                fieldId="sandbox-env"
                role="group"
              >
                <KeyValueEditor
                  rows={form.envRows}
                  onChange={form.setEnvRows}
                  keyPlaceholder="NAME"
                  valuePlaceholder="value"
                  testIdPrefix="sandbox-env"
                  itemLabel="Environment variable"
                  addLabel="Add variable"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={form.envError ? 'error' : 'default'}
                      data-testid="sandbox-env-help"
                    >
                      {form.envError ??
                        'Set in the sandbox and shown on its page. Not for API keys or tokens: attach a provider for those.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup
                label="Annotations"
                fieldId="sandbox-annotations"
                role="group"
              >
                <KeyValueEditor
                  rows={form.annotationRows}
                  onChange={form.setAnnotationRows}
                  testIdPrefix="sandbox-annotation"
                  itemLabel="Annotation"
                  addLabel="Add annotation"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={form.annotationsError ? 'error' : 'default'}
                      data-testid="sandbox-annotations-help"
                    >
                      {form.annotationsError ??
                        'Metadata kept with the sandbox. Unlike labels, annotations cannot be filtered on.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <SandboxLaunchFields
                workspace={workspace}
                options={form.launch}
                idPrefix="sandbox"
              />
              <FormGroup label="Log level" fieldId="sandbox-log-level">
                <FormSelect
                  id="sandbox-log-level"
                  data-testid="sandbox-log-level-select"
                  value={form.logLevel}
                  onChange={(_event, value) => form.setLogLevel(value)}
                >
                  <FormSelectOption value="" label="Gateway default" />
                  {LOG_LEVELS.map((level) => (
                    <FormSelectOption key={level} value={level} label={level} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Runtime class" fieldId="sandbox-runtime-class">
                <TextInput
                  id="sandbox-runtime-class"
                  data-testid="sandbox-runtime-class-input"
                  value={form.runtimeClassName}
                  onChange={(_event, value) => form.setRuntimeClassName(value)}
                  placeholder="Leave empty for the platform default"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      A Kubernetes RuntimeClass to run the sandbox with, for
                      example kata. The Docker and VM compute drivers refuse a
                      sandbox that names one.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup label="Driver config" fieldId="sandbox-driver-config">
                <TextArea
                  id="sandbox-driver-config"
                  data-testid="sandbox-driver-config-input"
                  value={form.driverConfigText}
                  onChange={(_event, value) => form.setDriverConfigText(value)}
                  rows={4}
                  resizeOrientation="vertical"
                  className="pf-v6-u-font-family-monospace"
                  placeholder='{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}'
                  validated={form.driverConfigError ? 'error' : 'default'}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={form.driverConfigError ? 'error' : 'default'}
                      data-testid="sandbox-driver-config-help"
                    >
                      {form.driverConfigError ??
                        'A JSON object keyed by compute driver name, for settings only that driver understands. The gateway refuses it unless its administrator has enabled allow_driver_config.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </FormSection>
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
          isDisabled={!form.isValid || isBusy}
          isLoading={isBusy}
          data-testid="create-sandbox-submit"
        >
          Create
        </Button>
        <Button
          variant="link"
          onClick={close}
          isDisabled={isBusy}
          data-testid="create-sandbox-cancel"
        >
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateSandboxModal;
