import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Label,
  Stack,
  StackItem,
  Title,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CodeEditor, Language } from '@patternfly/react-code-editor';
import { PlusCircleIcon } from '@patternfly/react-icons';

import { useSandbox } from '../../api/sandboxes';
import { useSandboxPolicy, useUpdateSandboxPolicy } from '../../api/policy';
import { useAlerts } from '../../app/AlertContext';
import { useWorkspaceRole } from '../../api/rbac';
import { useJsonValidation } from '../../hooks/useJsonValidation';
import PolicyRevisionTable from '../policy/PolicyRevisionTable';
import AddEndpointModal from './AddEndpointModal';
import NetworkRulesTable from './NetworkRulesTable';
import StaticPolicyCard from './StaticPolicyCard';
import { mergeRule, policyToYaml } from './utils';
import type { EndpointFormValues } from './utils';
import type { ApiError } from '../../api/client';
import type {
  NetworkEndpoint,
  NetworkPolicyRule,
  SandboxPolicy,
} from '../../types';

type PolicyRuleEditorProps = {
  workspace: string;
  sandboxName: string;
};

type ViewMode = 'form' | 'yaml';

const PolicyRuleEditor: React.FC<PolicyRuleEditorProps> = ({
  workspace,
  sandboxName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const policyView = useSandboxPolicy(workspace, sandboxName);
  const sandbox = useSandbox(workspace, sandboxName);
  const updatePolicy = useUpdateSandboxPolicy(workspace, sandboxName);
  const { addSuccess } = useAlerts();

  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [yamlText, setYamlText] = useState('');
  const [isAddOpen, setAddOpen] = useState(false);

  const currentPolicy: SandboxPolicy | undefined =
    policyView.data?.latest?.policy ?? sandbox.data?.spec.policy;

  const networkRules = currentPolicy?.networkPolicies ?? {};

  const { error: yamlParseError } = useJsonValidation(yamlText);
  const yamlError = yamlParseError
    ? 'Invalid JSON — the YAML view is read-only for now; edit via the form or paste valid JSON.'
    : null;

  const switchToYaml = () => {
    if (currentPolicy) {
      setYamlText(policyToYaml(currentPolicy));
    }
    setViewMode('yaml');
  };

  const submitAddEndpoint = (ruleName: string, form: EndpointFormValues) => {
    if (!currentPolicy || !form.host) return;

    const resolvedName = ruleName || form.host.replace(/[^a-z0-9]/gi, '_');
    const newEndpoint: NetworkEndpoint = {
      host: form.host,
      port: form.port,
      access: form.access,
      protocol: form.protocol,
      enforcement: form.enforcement,
    };

    const newRule: NetworkPolicyRule = {
      endpoints: [newEndpoint],
      binaries: form.binaryPath ? [{ path: form.binaryPath }] : undefined,
    };

    const updated: SandboxPolicy = {
      ...currentPolicy,
      networkPolicies: {
        ...networkRules,
        [resolvedName]: mergeRule(networkRules[resolvedName], newRule),
      },
    };

    updatePolicy.mutate(
      {
        policy: updated,
        expectedResourceVersion: sandbox.data?.metadata.resourceVersion,
      },
      {
        onSuccess: () => {
          addSuccess(`Endpoint ${form.host}:${form.port} added`);
          setAddOpen(false);
        },
      },
    );
  };

  const removeRule = (name: string) => {
    if (!currentPolicy) return;
    const remaining = { ...networkRules };
    delete remaining[name];
    updatePolicy.mutate(
      {
        policy: { ...currentPolicy, networkPolicies: remaining },
        expectedResourceVersion: sandbox.data?.metadata.resourceVersion,
      },
      { onSuccess: () => addSuccess(`Rule "${name}" removed`) },
    );
  };

  const notFound =
    policyView.isError && (policyView.error as ApiError).status === 404;

  return (
    <Stack hasGutter>
      <StackItem>
        <Toolbar aria-label="Policy view controls">
          <ToolbarContent>
            <ToolbarItem>
              <Label color="blue">
                Active version: {policyView.data?.activeVersion ?? '-'}
              </Label>
            </ToolbarItem>
            <ToolbarItem>
              <ToggleGroup aria-label="View mode">
                <ToggleGroupItem
                  text="Form"
                  isSelected={viewMode === 'form'}
                  onChange={() => setViewMode('form')}
                  data-testid="view-form"
                />
                <ToggleGroupItem
                  text="YAML"
                  isSelected={viewMode === 'yaml'}
                  onChange={switchToYaml}
                  data-testid="view-yaml"
                />
              </ToggleGroup>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </StackItem>

      {viewMode === 'yaml' ? (
        <StackItem>
          <Card>
            <CardTitle>Policy YAML</CardTitle>
            <CardBody>
              <CodeEditor
                isReadOnly
                code={yamlText}
                language={Language.yaml}
                height="28rem"
                data-testid="policy-yaml-editor"
              />
              {yamlError && (
                <Alert
                  variant="warning"
                  isInline
                  title="Read-only"
                  className="pf-v6-u-mt-sm"
                >
                  {yamlError}
                </Alert>
              )}
            </CardBody>
          </Card>
        </StackItem>
      ) : (
        <>
          <StackItem>
            <StaticPolicyCard policy={currentPolicy} />
          </StackItem>

          <StackItem>
            <Card>
              <CardTitle>Network rules (editable)</CardTitle>
              <CardBody>
                {isWorkspaceAdmin && (
                  <Toolbar aria-label="Network rule actions">
                    <ToolbarContent>
                      <ToolbarItem>
                        <Button
                          icon={<PlusCircleIcon />}
                          onClick={() => setAddOpen(true)}
                          data-testid="add-endpoint-button"
                        >
                          Add endpoint
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                )}
                <NetworkRulesTable
                  networkRules={networkRules}
                  isEditable={isWorkspaceAdmin}
                  onRemoveRule={removeRule}
                  isRemoving={updatePolicy.isPending}
                />
              </CardBody>
            </Card>
          </StackItem>
        </>
      )}

      {!notFound && (policyView.data?.revisions ?? []).length > 0 && (
        <StackItem>
          <Title headingLevel="h3">Revision history</Title>
          <PolicyRevisionTable
            revisions={policyView.data?.revisions ?? []}
            showLoaded
          />
        </StackItem>
      )}

      {updatePolicy.isError && (
        <StackItem>
          <Alert variant="danger" isInline title="Policy update failed">
            {(updatePolicy.error as Error).message}
          </Alert>
        </StackItem>
      )}

      <AddEndpointModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={submitAddEndpoint}
        isPending={updatePolicy.isPending}
        error={
          updatePolicy.isError
            ? (updatePolicy.error as Error).message
            : undefined
        }
      />
    </Stack>
  );
};

export default PolicyRuleEditor;
