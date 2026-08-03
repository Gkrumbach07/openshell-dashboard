import { useMemo, useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  CodeBlock,
  CodeBlockCode,
  Content,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CodeEditor, Language } from '@patternfly/react-code-editor';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useAlerts } from '../app/AlertContext';
import {
  useDeleteGlobalPolicy,
  useGlobalPolicy,
  useSetGlobalPolicy,
} from '../api/policy';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import {
  policyStatusColor,
  policyStatusIcon,
} from '../components/SandboxPolicyTab';
import { policyTemplates } from '../components/policyTemplates';
import { formatTimestamp } from '../components/utils';
import type { SandboxPolicy } from '../types';

// Gateway-global policy (Platform Admin). Setting it applies the policy to
// ALL sandboxes in full — there is no merge with per-sandbox policies.
const GlobalPolicyPage: React.FC = () => {
  const globalPolicy = useGlobalPolicy();
  const setGlobalPolicy = useSetGlobalPolicy();
  const deleteGlobalPolicy = useDeleteGlobalPolicy();
  const { addSuccess } = useAlerts();
  const [isEditOpen, setEditOpen] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [isDeleteOpen, setDeleteOpen] = useState(false);

  const policyError = useMemo(() => {
    try {
      JSON.parse(policyText || '{}');
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [policyText]);

  if (globalPolicy.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading global policy" />
        </Bullseye>
      </PageSection>
    );
  }

  if (globalPolicy.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title="Failed to load global policy"
          actionLinks={
            <Button variant="link" onClick={() => globalPolicy.refetch()}>
              Retry
            </Button>
          }
        >
          {(globalPolicy.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const view = globalPolicy.data;

  const openEditor = () => {
    const seed = view?.latest?.policy ?? policyTemplates[0].policy;
    setPolicyText(JSON.stringify(seed, null, 2));
    setGlobalPolicy.reset();
    setEditOpen(true);
  };

  const submit = () => {
    if (policyError) {
      return;
    }
    setGlobalPolicy.mutate(JSON.parse(policyText) as SandboxPolicy, {
      onSuccess: () => setEditOpen(false),
    });
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Global policy</Title>
        <Content component="p">
          A gateway-global policy applies to all sandboxes in full (no merge
          with per-sandbox policies). This is the platform ceiling mechanism —
          Platform Admin only.
        </Content>
      </PageSection>
      <PageSection>
        <Toolbar aria-label="Policy actions">
          <ToolbarContent>
            <ToolbarItem>
              <Button onClick={openEditor} data-testid="set-global-policy">
                {view?.revisions.length
                  ? 'Update global policy'
                  : 'Set global policy'}
              </Button>
            </ToolbarItem>
            {(view?.revisions.length ?? 0) > 0 && (
              <ToolbarItem>
                <Button
                  variant="danger"
                  onClick={() => {
                    deleteGlobalPolicy.reset();
                    setDeleteOpen(true);
                  }}
                  data-testid="delete-global-policy"
                >
                  Delete global policy
                </Button>
              </ToolbarItem>
            )}
          </ToolbarContent>
        </Toolbar>
        {(view?.revisions ?? []).length === 0 ? (
          <Content component="p">
            No global policy set — sandboxes are governed by their own policies.
          </Content>
        ) : (
          <Table
            aria-label="Global policy revisions"
            variant="compact"
            data-testid="global-policy-table"
          >
            <Thead>
              <Tr>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Hash</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(view?.revisions ?? []).map((revision) => (
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
                  <Td dataLabel="Created">
                    {formatTimestamp(revision.createdAtMs)}
                  </Td>
                  <Td
                    dataLabel="Hash"
                    className="pf-v6-u-font-family-monospace"
                  >
                    {(revision.policyHash ?? '').slice(0, 12) || '-'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        {view?.latest?.policy && (
          <>
            <Title headingLevel="h3" className="pf-v6-u-mt-md">
              Current global policy
            </Title>
            <CodeBlock>
              <CodeBlockCode>
                {JSON.stringify(view.latest.policy, null, 2)}
              </CodeBlockCode>
            </CodeBlock>
          </>
        )}
      </PageSection>
      <ConfirmDeleteModal
        title="Delete global policy?"
        body="Deleting the global policy restores sandbox-level policy control. Each sandbox will be governed by its own policy instead of the gateway-wide ceiling."
        isOpen={isDeleteOpen}
        isDeleting={deleteGlobalPolicy.isPending}
        error={
          deleteGlobalPolicy.isError
            ? (deleteGlobalPolicy.error as Error).message
            : undefined
        }
        onConfirm={() => {
          deleteGlobalPolicy.mutate(undefined, {
            onSuccess: () => {
              setDeleteOpen(false);
              addSuccess('Global policy deleted');
            },
          });
        }}
        onCancel={() => setDeleteOpen(false)}
      />
      <Modal
        variant="large"
        isOpen={isEditOpen}
        onClose={() => setEditOpen(false)}
        aria-label="Set global policy"
      >
        <ModalHeader
          title="Set global policy"
          description="Applies to ALL sandboxes immediately, replacing their effective policy."
        />
        <ModalBody>
          <CodeEditor
            isLanguageLabelVisible
            code={policyText}
            onChange={(value) => setPolicyText(value)}
            language={Language.json}
            height="24rem"
            data-testid="global-policy-input"
          />
          {policyError && (
            <Alert variant="danger" isInline title="Invalid JSON">
              {policyError}
            </Alert>
          )}
          {setGlobalPolicy.isError && (
            <Alert variant="danger" isInline title="Update failed">
              {(setGlobalPolicy.error as Error).message}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={submit}
            isDisabled={Boolean(policyError) || setGlobalPolicy.isPending}
            isLoading={setGlobalPolicy.isPending}
            data-testid="confirm-global-policy"
          >
            Apply to all sandboxes
          </Button>
          <Button variant="link" onClick={() => setEditOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default GlobalPolicyPage;
