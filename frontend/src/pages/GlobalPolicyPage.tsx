import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  List,
  ListItem,
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
import { useAlerts } from '../app/AlertContext';
import {
  useDeleteGlobalPolicy,
  useGlobalPolicy,
  useGlobalPolicyRevision,
  useSetGlobalPolicy,
} from '../api/policy';
import { usePolicyText } from '../hooks/usePolicyText';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import PolicyDocumentInput from '../components/policy/PolicyDocumentInput';
import PolicyPayload from '../components/policy/PolicyPayload';
import PolicyRevisionDetails from '../components/policy/PolicyRevisionDetails';
import PolicyRevisionTable from '../components/policy/PolicyRevisionTable';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import { policyTemplates } from '../components/policy/policyTemplates';
import type { PolicyRevision } from '../types';

// One global revision, opened. The listing carries the policy of the newest
// revision only, so any other is read when its row is opened.
const GlobalRevisionDetails: React.FC<{ revision: PolicyRevision }> = ({
  revision,
}) => {
  const needsPayload = !revision.policy;
  const fetched = useGlobalPolicyRevision(revision.version, needsPayload);
  return (
    <PolicyRevisionDetails
      revision={fetched.data ?? revision}
      isLoading={needsPayload && fetched.isLoading}
      error={
        needsPayload && fetched.isError
          ? (fetched.error as Error).message
          : undefined
      }
    />
  );
};

// Gateway-global policy (Platform Admin). Setting it applies the policy to
// ALL sandboxes in full — there is no merge with per-sandbox policies.
const GlobalPolicyPage: React.FC = () => {
  const globalPolicy = useGlobalPolicy();
  const setGlobalPolicy = useSetGlobalPolicy();
  const deleteGlobalPolicy = useDeleteGlobalPolicy();
  const { addSuccess } = useAlerts();
  const [isEditOpen, setEditOpen] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [isSeedTemplate, setSeedTemplate] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);

  // The document in the editor, read as whichever it is: a YAML policy file
  // or the gateway's JSON. It is state of this page and nothing re-reads it,
  // so the refresh of the page behind the editor leaves it alone.
  const reading = usePolicyText(policyText);
  const policyErrors = policyText.trim()
    ? reading.diagnostics.map((diagnostic) => diagnostic.message)
    : ['The policy document is empty.'];
  const canApply = reading.parsed !== null;

  if (globalPolicy.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading global policy" />
        </Bullseye>
      </PageSection>
    );
  }

  // The global policy is re-read while the page is open. A refresh that
  // fails leaves the page, and a policy being written in the editor, as they
  // were, with a note above; only a first load that failed takes the page.
  const refreshFailed = isRefreshError(globalPolicy);
  if (globalPolicy.isError && !refreshFailed) {
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
  const revisions = view?.revisions ?? [];
  // Deleting a global policy leaves its revisions behind, superseded, so a
  // history is not a policy: activeVersion is zero when none is in force.
  const activeVersion = view?.activeVersion ?? 0;
  const inForce = activeVersion > 0;

  const openEditor = () => {
    // Start from the newest global policy when there is one to read. A
    // starter template stands in only when there is not, and the editor says
    // so: applying it replaces whatever is in force.
    const current = view?.latest?.policy;
    setSeedTemplate(!current);
    setPolicyText(
      JSON.stringify(current ?? policyTemplates[0].policy, null, 2),
    );
    setGlobalPolicy.reset();
    setEditOpen(true);
  };

  const submit = () => {
    if (!reading.parsed) {
      return;
    }
    setGlobalPolicy.mutate(reading.parsed, {
      onSuccess: (result) => {
        setEditOpen(false);
        addSuccess(`Global policy revision ${result.version} is in force`);
      },
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
        {refreshFailed && (
          <RefreshErrorAlert
            title="The global policy could not be refreshed"
            error={globalPolicy.error}
            onRetry={() => globalPolicy.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="global-policy-refresh-error"
          />
        )}
        {inForce ? (
          <Alert
            variant="warning"
            isInline
            title={`Global policy revision ${activeVersion} is in force`}
            data-testid="global-policy-in-force"
            className="pf-v6-u-mb-md"
          >
            Every sandbox on this gateway enforces it in place of its own
            policy, and sandbox policies cannot be changed or proposals approved
            until it is deleted.
          </Alert>
        ) : (
          <Alert
            variant="info"
            isInline
            title="No global policy is in force"
            data-testid="global-policy-not-in-force"
            className="pf-v6-u-mb-md"
          >
            Sandboxes are governed by their own policies.
            {revisions.length > 0 &&
              ' The revisions below are the history of global policies that were set and later deleted.'}
          </Alert>
        )}
        <Toolbar aria-label="Policy actions">
          <ToolbarContent>
            <ToolbarItem>
              <Button onClick={openEditor} data-testid="set-global-policy">
                {inForce ? 'Update global policy' : 'Set global policy'}
              </Button>
            </ToolbarItem>
            {inForce && (
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
        {revisions.length > 0 && (
          <PolicyRevisionTable
            revisions={revisions}
            activeVersion={activeVersion}
            showLoaded
            showError
            renderDetails={(revision) => (
              <GlobalRevisionDetails revision={revision} />
            )}
            aria-label="Global policy revisions"
            data-testid="global-policy-table"
          />
        )}
        {inForce && view?.latest?.policy && (
          <>
            <Title headingLevel="h3" className="pf-v6-u-mt-md">
              Current global policy
            </Title>
            <PolicyPayload
              policy={view.latest.policy}
              fileName="global-policy"
              data-testid="current-global-policy"
            />
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
          {isSeedTemplate && (
            <Alert
              variant={inForce ? 'warning' : 'info'}
              isInline
              title={
                inForce
                  ? 'This is a starter template, not the policy in force'
                  : 'This is a starter template'
              }
              data-testid="global-policy-seed-template"
              className="pf-v6-u-mb-sm"
            >
              {inForce
                ? 'The policy in force could not be read, so the editor could not start from it. Applying this document replaces it.'
                : 'There is no earlier global policy to start from. Edit it, paste a policy, or load one from a file.'}
            </Alert>
          )}
          <Content component="small" className="pf-v6-u-mb-sm">
            Edit the document, paste one, or load one from a .yaml, .yml or
            .json file (`openshell policy set --global --policy`).
          </Content>
          <PolicyDocumentInput
            text={policyText}
            onChange={setPolicyText}
            reading={reading}
            height="24rem"
            data-testid="global-policy-input"
          />
          {!canApply && (
            <Alert
              variant="danger"
              isInline
              title="This document cannot be applied"
              className="pf-v6-u-mt-sm"
              data-testid="global-policy-document-error"
            >
              {policyErrors.length === 1 ? (
                policyErrors[0]
              ) : (
                <List isPlain>
                  {policyErrors.map((message) => (
                    <ListItem key={message}>{message}</ListItem>
                  ))}
                </List>
              )}
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
            isDisabled={!canApply || setGlobalPolicy.isPending}
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
