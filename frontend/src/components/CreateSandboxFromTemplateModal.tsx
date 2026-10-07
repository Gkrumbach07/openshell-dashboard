import { useMemo, useState } from 'react';
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
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';

import { useProviders } from '../api/providers';
import { useApplyApprovalMode } from '../api/sandboxSettings';
import { useCreateSandboxFromTemplate } from '../api/templates';
import { useAlerts } from '../app/AlertContext';
import { POLICY_REQUIRED, parseLabels } from '../hooks/useCreateSandboxForm';
import { usePolicyText } from '../hooks/usePolicyText';
import { useSandboxLaunchOptions } from '../hooks/useSandboxLaunchOptions';
import KeyValueEditor from './KeyValueEditor';
import { policyTemplates } from './policy/policyTemplates';
import PolicyTextField from './policy/PolicyTextField';
import ApprovalModeFailureAlert from './sandbox/ApprovalModeFailureAlert';
import SandboxLaunchFields from './sandbox/SandboxLaunchFields';
import { rowsToRecord, type KeyValueRow } from '../utils/sandboxOptions';

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
  // What a template does not hold and the sandbox can still be given: its own
  // labels and annotations, its main command, the services to expose and the
  // approval mode. The workload stays the template's.
  const [labelsText, setLabelsText] = useState('');
  const [annotationRows, setAnnotationRows] = useState<KeyValueRow[]>([]);
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);
  const launch = useSandboxLaunchOptions();
  const approvalMode = useApplyApprovalMode(workspace);

  // The policy is read from whatever it was given as: the JSON of a preset,
  // or a policy file, YAML or JSON, pasted or loaded over it.
  const { error: readError, parsed: parsedPolicy } = usePolicyText(policyText);
  const policyError = policyText.trim() ? readError : POLICY_REQUIRED;
  const activeTemplate = useMemo(
    () =>
      policyTemplates.find((candidate) => candidate.id === policyTemplateId),
    [policyTemplateId],
  );
  const labels = parseLabels(labelsText);
  const { record: annotations, error: annotationsError } =
    rowsToRecord(annotationRows);
  // The section opens by itself around a field that needs correcting.
  const hasAdvancedError = Boolean(annotationsError) || !launch.isValid;
  const isValid =
    !policyError &&
    Boolean(parsedPolicy) &&
    labels !== null &&
    !hasAdvancedError;

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
    setLabelsText('');
    setAnnotationRows([]);
    setAdvancedExpanded(false);
    launch.reset();
    applyPolicyTemplate(policyTemplates[0].id);
  };

  const close = () => {
    reset();
    createFromTemplate.reset();
    approvalMode.reset();
    onClose();
  };

  const submit = () => {
    if (!isValid || !parsedPolicy || labels === null) {
      return;
    }
    const mode = launch.approvalMode;
    createFromTemplate.mutate(
      {
        name: name || undefined,
        templateName,
        providers: selectedProviders.length > 0 ? selectedProviders : undefined,
        policy: parsedPolicy,
        labels: Object.keys(labels).length > 0 ? labels : undefined,
        annotations:
          Object.keys(annotations).length > 0 ? annotations : undefined,
        ...launch.payload,
      },
      {
        onSuccess: async (sandbox) => {
          // The approval mode is a setting of the sandbox, written once the
          // sandbox exists. If that fails the sandbox stays and the modal
          // says so instead of closing.
          if (await approvalMode.apply(sandbox, mode)) {
            addSuccess(`Sandbox created from template "${templateName}"`);
            close();
          }
        },
      },
    );
  };

  if (approvalMode.failure) {
    return (
      <Modal
        variant="medium"
        isOpen={isOpen}
        onClose={close}
        aria-label="Create sandbox from template"
      >
        <ModalHeader title={`Create sandbox from "${templateName}"`} />
        <ModalBody>
          <ApprovalModeFailureAlert failure={approvalMode.failure} />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={close}
            data-testid="create-from-template-done"
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
  const isBusy = createFromTemplate.isPending || approvalMode.isApplying;

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={isBusy ? undefined : close}
      aria-label="Create sandbox from template"
    >
      <ModalHeader
        title={`Create sandbox from "${templateName}"`}
        description="The image, environment, and resources come from the template. Supply a security policy and any providers to attach, and optionally what the sandbox runs."
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
          <FormGroup label="Labels" fieldId="from-template-labels">
            <TextInput
              id="from-template-labels"
              data-testid="from-template-labels-input"
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
            <PolicyTextField
              id="from-template-policy"
              data-testid="from-template-policy-input"
              value={policyText}
              onChange={setPolicyText}
              error={policyError}
            />
          </ExpandableSection>
          <ExpandableSection
            toggleText="Advanced options"
            isExpanded={isAdvancedExpanded || hasAdvancedError}
            onToggle={(_event, expanded) => setAdvancedExpanded(expanded)}
            data-testid="from-template-advanced-expand"
          >
            <FormSection>
              <FormGroup
                label="Annotations"
                fieldId="from-template-annotations"
                role="group"
              >
                <KeyValueEditor
                  rows={annotationRows}
                  onChange={setAnnotationRows}
                  testIdPrefix="from-template-annotation"
                  addLabel="Add annotation"
                  itemLabel="Annotation"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={annotationsError ? 'error' : 'default'}
                      data-testid="from-template-annotations-help"
                    >
                      {annotationsError ??
                        'Metadata kept with the sandbox. Unlike labels, annotations cannot be filtered on.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <SandboxLaunchFields
                workspace={workspace}
                options={launch}
                idPrefix="from-template"
              />
            </FormSection>
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
          isDisabled={!isValid || isBusy}
          isLoading={isBusy}
          data-testid="create-from-template-submit"
        >
          Create
        </Button>
        <Button
          variant="link"
          onClick={close}
          isDisabled={isBusy}
          data-testid="create-from-template-cancel"
        >
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateSandboxFromTemplateModal;
