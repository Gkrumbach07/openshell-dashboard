import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberInput,
  Stack,
  StackItem,
  TextInput,
  Title,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CodeEditor, Language } from '@patternfly/react-code-editor';
import {
  PlusCircleIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useSandbox } from '../api/sandboxes';
import { useSandboxPolicy, useUpdateSandboxPolicy } from '../api/policy';
import { useAlerts } from '../app/AlertContext';
import { useWorkspaceRole } from '../app/useWorkspaceRole';
import { policyStatusColor, policyStatusIcon } from './SandboxPolicyTab';
import { formatTimestamp } from './utils';
import type { ApiError } from '../api/client';
import type {
  NetworkEndpoint,
  NetworkPolicyRule,
  SandboxPolicy,
} from '../types';

type PolicyRuleEditorProps = {
  workspace: string;
  sandboxName: string;
};

type ViewMode = 'form' | 'yaml';

type EndpointFormValues = {
  host: string;
  port: number;
  access: string;
  protocol: string;
  enforcement: string;
  binaryPath: string;
};

const emptyEndpoint: EndpointFormValues = {
  host: '',
  port: 443,
  access: 'read-only',
  protocol: 'rest',
  enforcement: 'enforce',
  binaryPath: '',
};

const policyToYaml = (policy: SandboxPolicy): string => {
  const lines: string[] = [];
  lines.push(`version: ${policy.version ?? 1}`);
  if (policy.filesystem) {
    lines.push('filesystem:');
    if (policy.filesystem.includeWorkdir !== undefined) {
      lines.push(`  includeWorkdir: ${policy.filesystem.includeWorkdir}`);
    }
    if (policy.filesystem.readOnly?.length) {
      lines.push('  readOnly:');
      policy.filesystem.readOnly.forEach((p) => lines.push(`    - ${p}`));
    }
    if (policy.filesystem.readWrite?.length) {
      lines.push('  readWrite:');
      policy.filesystem.readWrite.forEach((p) => lines.push(`    - ${p}`));
    }
  }
  if (policy.landlock?.compatibility) {
    lines.push('landlock:');
    lines.push(`  compatibility: ${policy.landlock.compatibility}`);
  }
  if (policy.process) {
    lines.push('process:');
    if (policy.process.runAsUser) lines.push(`  runAsUser: ${policy.process.runAsUser}`);
    if (policy.process.runAsGroup) lines.push(`  runAsGroup: ${policy.process.runAsGroup}`);
  }
  lines.push('networkPolicies:');
  const rules = policy.networkPolicies ?? {};
  if (Object.keys(rules).length === 0) {
    lines.push('  {}');
  } else {
    Object.entries(rules).forEach(([name, rule]) => {
      lines.push(`  ${name}:`);
      if (rule.endpoints?.length) {
        lines.push('    endpoints:');
        rule.endpoints.forEach((ep) => {
          lines.push(`      - host: ${ep.host || '*'}`);
          if (ep.port) lines.push(`        port: ${ep.port}`);
          if (ep.protocol) lines.push(`        protocol: ${ep.protocol}`);
          if (ep.enforcement) lines.push(`        enforcement: ${ep.enforcement}`);
          if (ep.access) lines.push(`        access: ${ep.access}`);
        });
      }
      if (rule.binaries?.length) {
        lines.push('    binaries:');
        rule.binaries.forEach((b) => lines.push(`      - path: ${b.path}`));
      }
    });
  }
  return lines.join('\n') + '\n';
};

const endpointSummary = (ep: NetworkEndpoint): string => {
  const parts = [ep.host || '*'];
  if (ep.port) parts.push(String(ep.port));
  if (ep.access) parts.push(ep.access);
  if (ep.protocol) parts.push(ep.protocol);
  if (ep.enforcement) parts.push(ep.enforcement);
  return parts.join(':');
};

const PolicyRuleEditor: React.FC<PolicyRuleEditorProps> = ({ workspace, sandboxName }) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const policyView = useSandboxPolicy(workspace, sandboxName);
  const sandbox = useSandbox(workspace, sandboxName);
  const updatePolicy = useUpdateSandboxPolicy(workspace, sandboxName);
  const { addSuccess } = useAlerts();

  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [yamlText, setYamlText] = useState('');
  const [isAddOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<EndpointFormValues>({ ...emptyEndpoint });
  const [addRuleName, setAddRuleName] = useState('');

  const currentPolicy: SandboxPolicy | undefined =
    policyView.data?.latest?.policy ?? sandbox.data?.spec.policy;

  const networkRules = currentPolicy?.networkPolicies ?? {};

  const yamlError = useMemo(() => {
    if (!yamlText.trim()) return null;
    try {
      JSON.parse(yamlText);
      return null;
    } catch {
      return 'Invalid JSON — the YAML view is read-only for now; edit via the form or paste valid JSON.';
    }
  }, [yamlText]);

  const switchToYaml = () => {
    if (currentPolicy) {
      setYamlText(policyToYaml(currentPolicy));
    }
    setViewMode('yaml');
  };

  const submitAddEndpoint = () => {
    if (!currentPolicy || !addForm.host) return;

    const ruleName = addRuleName || addForm.host.replace(/[^a-z0-9]/gi, '_');
    const newEndpoint: NetworkEndpoint = {
      host: addForm.host,
      port: addForm.port,
      access: addForm.access,
      protocol: addForm.protocol,
      enforcement: addForm.enforcement,
    };

    const newRule: NetworkPolicyRule = {
      endpoints: [newEndpoint],
      binaries: addForm.binaryPath ? [{ path: addForm.binaryPath }] : undefined,
    };

    const updated: SandboxPolicy = {
      ...currentPolicy,
      networkPolicies: {
        ...networkRules,
        [ruleName]: existingRule(networkRules[ruleName], newRule),
      },
    };

    updatePolicy.mutate(
      { policy: updated, expectedResourceVersion: sandbox.data?.metadata.resourceVersion },
      {
        onSuccess: () => {
          addSuccess(`Endpoint ${addForm.host}:${addForm.port} added`);
          setAddOpen(false);
          setAddForm({ ...emptyEndpoint });
          setAddRuleName('');
        },
      },
    );
  };

  const removeRule = (ruleName: string) => {
    if (!currentPolicy) return;
    const remaining = { ...networkRules };
    delete remaining[ruleName];
    updatePolicy.mutate(
      {
        policy: { ...currentPolicy, networkPolicies: remaining },
        expectedResourceVersion: sandbox.data?.metadata.resourceVersion,
      },
      { onSuccess: () => addSuccess(`Rule "${ruleName}" removed`) },
    );
  };

  const notFound = policyView.isError && (policyView.error as ApiError).status === 404;

  return (
    <Stack hasGutter>
      <StackItem>
        <Toolbar aria-label="Policy view controls">
          <ToolbarContent>
            <ToolbarItem>
              <Label color="blue">Active version: {policyView.data?.activeVersion ?? '-'}</Label>
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
                <Alert variant="warning" isInline title="Read-only" className="pf-v6-u-mt-sm">
                  {yamlError}
                </Alert>
              )}
            </CardBody>
          </Card>
        </StackItem>
      ) : (
        <>
          <StackItem>
            <Card>
              <CardTitle>
                Static policy (immutable after create)
              </CardTitle>
              <CardBody>
                <Table aria-label="Static policy" variant="compact">
                  <Tbody>
                    <Tr>
                      <Td>Filesystem read-only</Td>
                      <Td>{currentPolicy?.filesystem?.readOnly?.join(', ') || '-'}</Td>
                    </Tr>
                    <Tr>
                      <Td>Filesystem read-write</Td>
                      <Td>{currentPolicy?.filesystem?.readWrite?.join(', ') || '-'}</Td>
                    </Tr>
                    <Tr>
                      <Td>Landlock</Td>
                      <Td>{currentPolicy?.landlock?.compatibility || '-'}</Td>
                    </Tr>
                    <Tr>
                      <Td>Process</Td>
                      <Td>
                        {currentPolicy?.process
                          ? `${currentPolicy.process.runAsUser || '-'}:${currentPolicy.process.runAsGroup || '-'}`
                          : '-'}
                      </Td>
                    </Tr>
                  </Tbody>
                </Table>
              </CardBody>
            </Card>
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
                {Object.keys(networkRules).length === 0 ? (
                  <Alert variant="info" isInline title="No network rules">
                    This sandbox has no network egress. Add an endpoint to allow outbound connections.
                  </Alert>
                ) : (
                  <Table aria-label="Network rules" variant="compact" data-testid="network-rules-table">
                    <Thead>
                      <Tr>
                        <Th>Rule name</Th>
                        <Th>Endpoints</Th>
                        <Th>Binaries</Th>
                        {isWorkspaceAdmin && <Th screenReaderText="Actions" />}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {Object.entries(networkRules).map(([name, rule]) => (
                        <Tr key={name}>
                          <Td dataLabel="Rule name">
                            <Label isCompact color="blue">{name}</Label>
                          </Td>
                          <Td dataLabel="Endpoints">
                            {(rule.endpoints ?? []).map((ep, i) => (
                              <Label key={i} isCompact color="teal" className="pf-v6-u-mr-xs">
                                {endpointSummary(ep)}
                              </Label>
                            ))}
                            {(rule.endpoints ?? []).length === 0 && '-'}
                          </Td>
                          <Td dataLabel="Binaries">
                            {(rule.binaries ?? []).map((b) => b.path).join(', ') || '-'}
                          </Td>
                          {isWorkspaceAdmin && (
                            <Td isActionCell>
                              <Button
                                variant="plain"
                                icon={<TrashIcon />}
                                onClick={() => removeRule(name)}
                                isDisabled={updatePolicy.isPending}
                                aria-label={`Remove rule ${name}`}
                                data-testid={`remove-rule-${name}`}
                              />
                            </Td>
                          )}
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </StackItem>
        </>
      )}

      {!notFound && (policyView.data?.revisions ?? []).length > 0 && (
        <StackItem>
          <Title headingLevel="h3">Revision history</Title>
          <Table aria-label="Policy revisions" variant="compact" data-testid="policy-revisions-table">
            <Thead>
              <Tr>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Loaded</Th>
                <Th>Hash</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(policyView.data?.revisions ?? []).map((revision) => (
                <Tr key={revision.version}>
                  <Td dataLabel="Version">{revision.version}</Td>
                  <Td dataLabel="Status">
                    <Label
                      isCompact
                      color={policyStatusColor(revision.status)}
                      icon={policyStatusIcon(revision.status)}
                    >
                      {revision.status}
                    </Label>
                  </Td>
                  <Td dataLabel="Created">{formatTimestamp(revision.createdAtMs)}</Td>
                  <Td dataLabel="Loaded">{formatTimestamp(revision.loadedAtMs)}</Td>
                  <Td dataLabel="Hash" className="pf-v6-u-font-family-monospace">
                    {(revision.policyHash ?? '').slice(0, 12) || '-'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </StackItem>
      )}

      {updatePolicy.isError && (
        <StackItem>
          <Alert variant="danger" isInline title="Policy update failed">
            {(updatePolicy.error as Error).message}
          </Alert>
        </StackItem>
      )}

      <Modal variant="medium" isOpen={isAddOpen} onClose={() => setAddOpen(false)} aria-label="Add endpoint">
        <ModalHeader
          title="Add network endpoint"
          description="Adds an endpoint to the sandbox's network policy. Maps to `policy update --add-endpoint host:port:access:protocol:enforcement`."
        />
        <ModalBody>
          <Form>
            <FormGroup label="Rule name" fieldId="rule-name">
              <TextInput
                id="rule-name"
                data-testid="rule-name-input"
                value={addRuleName}
                onChange={(_event, value) => setAddRuleName(value)}
                placeholder="Auto-generated from host if empty"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    The network_policies map key. Leave empty to derive from the hostname.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Host" isRequired fieldId="endpoint-host">
              <TextInput
                id="endpoint-host"
                data-testid="endpoint-host-input"
                isRequired
                value={addForm.host}
                onChange={(_event, value) => setAddForm((f) => ({ ...f, host: value }))}
                placeholder="api.anthropic.com"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Hostname or glob pattern. Use ** for any host.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Port" isRequired fieldId="endpoint-port">
              <NumberInput
                id="endpoint-port"
                data-testid="endpoint-port-input"
                value={addForm.port}
                min={1}
                max={65535}
                onMinus={() => setAddForm((f) => ({ ...f, port: Math.max(1, f.port - 1) }))}
                onPlus={() => setAddForm((f) => ({ ...f, port: Math.min(65535, f.port + 1) }))}
                onChange={(event) => {
                  const value = Number((event.target as HTMLInputElement).value);
                  if (!isNaN(value)) setAddForm((f) => ({ ...f, port: value }));
                }}
              />
            </FormGroup>
            <FormGroup label="Access" fieldId="endpoint-access">
              <FormSelect
                id="endpoint-access"
                data-testid="endpoint-access-select"
                value={addForm.access}
                onChange={(_event, value) => setAddForm((f) => ({ ...f, access: value }))}
              >
                <FormSelectOption value="read-only" label="Read-only" />
                <FormSelectOption value="read-write" label="Read-write" />
                <FormSelectOption value="full" label="Full" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Protocol" fieldId="endpoint-protocol">
              <FormSelect
                id="endpoint-protocol"
                data-testid="endpoint-protocol-select"
                value={addForm.protocol}
                onChange={(_event, value) => setAddForm((f) => ({ ...f, protocol: value }))}
              >
                <FormSelectOption value="rest" label="REST" />
                <FormSelectOption value="websocket" label="WebSocket" />
                <FormSelectOption value="graphql" label="GraphQL" />
                <FormSelectOption value="mcp" label="MCP" />
                <FormSelectOption value="" label="L4 only (no L7 inspection)" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Enforcement" fieldId="endpoint-enforcement">
              <FormSelect
                id="endpoint-enforcement"
                data-testid="endpoint-enforcement-select"
                value={addForm.enforcement}
                onChange={(_event, value) => setAddForm((f) => ({ ...f, enforcement: value }))}
              >
                <FormSelectOption value="enforce" label="Enforce (block violations)" />
                <FormSelectOption value="audit" label="Audit (log only)" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Binary path" fieldId="endpoint-binary">
              <TextInput
                id="endpoint-binary"
                data-testid="endpoint-binary-input"
                value={addForm.binaryPath}
                onChange={(_event, value) => setAddForm((f) => ({ ...f, binaryPath: value }))}
                placeholder="/usr/bin/git (optional)"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Restrict this endpoint to a specific binary. Leave empty to allow any process.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </Form>
          {updatePolicy.isError && (
            <Alert variant="danger" isInline title="Failed to add endpoint" className="pf-v6-u-mt-md">
              {(updatePolicy.error as Error).message}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={submitAddEndpoint}
            isDisabled={!addForm.host || updatePolicy.isPending}
            isLoading={updatePolicy.isPending}
            data-testid="submit-add-endpoint"
          >
            Add endpoint
          </Button>
          <Button variant="link" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </Stack>
  );
};

function existingRule(
  existing: NetworkPolicyRule | undefined,
  incoming: NetworkPolicyRule,
): NetworkPolicyRule {
  if (!existing) return incoming;
  return {
    endpoints: [...(existing.endpoints ?? []), ...(incoming.endpoints ?? [])],
    binaries: [
      ...(existing.binaries ?? []),
      ...(incoming.binaries ?? []),
    ].length > 0
      ? [...(existing.binaries ?? []), ...(incoming.binaries ?? [])]
      : undefined,
  };
}

export default PolicyRuleEditor;
