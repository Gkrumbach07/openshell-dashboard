import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  CodeBlock,
  CodeBlockCode,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  TextArea,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';

import { useSandbox } from '../../api/sandboxes';
import { useSandboxPolicy, useUpdateSandboxPolicy } from '../../api/policy';
import { useWorkspaceRole } from '../../api/rbac';
import { useJsonValidation } from '../../hooks/useJsonValidation';
import PolicyRevisionTable from '../policy/PolicyRevisionTable';
import type { ApiError } from '../../api/client';
import type { SandboxPolicy } from '../../types';

type SandboxPolicyTabProps = {
  workspace: string;
  sandboxName: string;
};

// Policy tab: current policy, revision history with load status, and an
// editor. Only network_policies (and inference fields) can change after
// create — filesystem/landlock/process are immutable, so the editor keeps
// the static fields from the current policy and replaces networkPolicies.
const SandboxPolicyTab: React.FC<SandboxPolicyTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const policyView = useSandboxPolicy(workspace, sandboxName);
  const sandbox = useSandbox(workspace, sandboxName);
  const updatePolicy = useUpdateSandboxPolicy(workspace, sandboxName);
  const [isEditOpen, setEditOpen] = useState(false);
  const [networkText, setNetworkText] = useState('');

  // Prefer the latest revision's policy payload; fall back to spec.policy.
  const currentPolicy: SandboxPolicy | undefined =
    policyView.data?.latest?.policy ?? sandbox.data?.spec.policy;

  const { error: networkError, parsed: parsedNetwork } = useJsonValidation(
    networkText || '{}',
  );

  if (policyView.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading policy" />
      </Bullseye>
    );
  }

  // A 404 just means no revisions recorded yet — fall through and render
  // the create-time policy from spec.policy with an empty history.
  const notFound =
    policyView.isError && (policyView.error as ApiError).status === 404;
  if (policyView.isError && !notFound) {
    return (
      <Alert
        variant="danger"
        title="Failed to load policy"
        actionLinks={
          <Button variant="link" onClick={() => policyView.refetch()}>
            Retry
          </Button>
        }
      >
        {(policyView.error as Error).message}
      </Alert>
    );
  }

  const openEditor = () => {
    setNetworkText(
      JSON.stringify(currentPolicy?.networkPolicies ?? {}, null, 2),
    );
    updatePolicy.reset();
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (networkError || !currentPolicy || !parsedNetwork) {
      return;
    }
    const policy: SandboxPolicy = {
      ...currentPolicy,
      networkPolicies: parsedNetwork as SandboxPolicy['networkPolicies'],
    };
    updatePolicy.mutate(
      {
        policy,
        expectedResourceVersion: sandbox.data?.metadata.resourceVersion,
      },
      { onSuccess: () => setEditOpen(false) },
    );
  };

  return (
    <>
      <Toolbar aria-label="Policy actions">
        <ToolbarContent>
          <ToolbarItem>
            <Label color="blue">
              Active version: {policyView.data?.activeVersion ?? '-'}
            </Label>
          </ToolbarItem>
          {isWorkspaceAdmin && (
            <ToolbarItem>
              <Button
                onClick={openEditor}
                isDisabled={!currentPolicy}
                data-testid="edit-policy"
              >
                Edit network rules
              </Button>
            </ToolbarItem>
          )}
        </ToolbarContent>
      </Toolbar>

      <Title headingLevel="h3">Revision history</Title>
      <PolicyRevisionTable
        revisions={policyView.data?.revisions ?? []}
        showLoaded
        showError
      />

      {currentPolicy && (
        <>
          <Title headingLevel="h3" className="pf-v6-u-mt-md">
            Current policy
          </Title>
          <CodeBlock>
            <CodeBlockCode data-testid="current-policy-json">
              {JSON.stringify(currentPolicy, null, 2)}
            </CodeBlockCode>
          </CodeBlock>
        </>
      )}

      <Modal
        variant="large"
        isOpen={isEditOpen}
        onClose={() => setEditOpen(false)}
        aria-label="Edit network rules"
      >
        <ModalHeader
          title="Edit network rules"
          description="Filesystem, landlock, and process settings are immutable after create — only networkPolicies can change. The static fields are kept from the current policy."
        />
        <ModalBody>
          <TextArea
            aria-label="networkPolicies JSON"
            data-testid="network-policies-input"
            value={networkText}
            onChange={(_event, value) => setNetworkText(value)}
            rows={18}
            className="pf-v6-u-font-family-monospace"
            validated={networkError ? 'error' : 'default'}
          />
          {networkError && (
            <Alert variant="danger" isInline title="Invalid JSON">
              {networkError}
            </Alert>
          )}
          {updatePolicy.isError && (
            <Alert variant="danger" isInline title="Update failed">
              {(updatePolicy.error as Error).message}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={submitEdit}
            isDisabled={Boolean(networkError) || updatePolicy.isPending}
            isLoading={updatePolicy.isPending}
            data-testid="save-policy"
          >
            Save policy
          </Button>
          <Button variant="link" onClick={() => setEditOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default SandboxPolicyTab;
