import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
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
import { PlusCircleIcon } from '@patternfly/react-icons';

import { useSandbox } from '../../api/sandboxes';
import {
  useEffectiveSandboxPolicy,
  useMergeSandboxPolicy,
  useSandboxPolicy,
  useUpdateSandboxPolicy,
} from '../../api/policy';
import { useAlerts } from '../../app/AlertContext';
import { useWorkspaceRole } from '../../api/rbac';
import PolicyRevisionDetails from '../policy/PolicyRevisionDetails';
import PolicyRevisionTable from '../policy/PolicyRevisionTable';
import { policyStatusColor, policyStatusIcon } from '../policy/policyUtils';
import AddEndpointModal from './AddEndpointModal';
import AddL7RuleModal from './AddL7RuleModal';
import NetworkRulesTable from './NetworkRulesTable';
import PolicyDocumentEditor from './PolicyDocumentEditor';
import type {
  PolicyDocumentDraft,
  PolicyDraftBase,
} from './PolicyDocumentEditor';
import StaticPolicyCard from './StaticPolicyCard';
import {
  addEndpointOperation,
  addL7RuleOperation,
  removeEndpointOperations,
  removeRuleOperation,
  splitRules,
} from './utils';
import type { EndpointFormValues, L7RuleKind } from './utils';
import type { ApiError } from '../../api/client';
import type {
  NetworkEndpoint,
  PolicyMergeOperation,
  SandboxPolicy,
} from '../../types';

type PolicyRuleEditorProps = {
  workspace: string;
  sandboxName: string;
};

type ViewMode = 'rules' | 'document';

type L7Target = { ruleName: string; endpoint: NetworkEndpoint };

const GLOBAL_POLICY_BLOCK =
  'A gateway-global policy is in force, and the gateway refuses changes to a sandbox policy until it is deleted.';

const PolicyRuleEditor: React.FC<PolicyRuleEditorProps> = ({
  workspace,
  sandboxName,
}) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const policyView = useSandboxPolicy(workspace, sandboxName);
  const effective = useEffectiveSandboxPolicy(workspace, sandboxName);
  const sandbox = useSandbox(workspace, sandboxName);
  const mergePolicy = useMergeSandboxPolicy(workspace, sandboxName);
  const replacePolicy = useUpdateSandboxPolicy(workspace, sandboxName);
  const { addSuccess } = useAlerts();

  const [viewMode, setViewMode] = useState<ViewMode>('rules');
  // A policy document being edited is kept here, not in the document view,
  // so that a look at the rules and back does not throw it away.
  const [documentDraft, setDocumentDraft] =
    useState<PolicyDocumentDraft | null>(null);
  // Whether a document is being checked against the sandbox before it is
  // sent, and why it was not sent when that check could not be made.
  const [isConfirming, setConfirming] = useState(false);
  const [notSentReason, setNotSentReason] = useState<string>();
  const [isAddOpen, setAddOpen] = useState(false);
  const [l7Target, setL7Target] = useState<L7Target | null>(null);

  // The sandbox's own policy: its latest revision, or what it was created
  // with before the first revision exists. Never the effective policy, whose
  // provider rules the gateway would refuse to take back.
  const currentPolicy: SandboxPolicy | undefined =
    policyView.data?.latest?.policy ?? sandbox.data?.spec.policy;
  const ownRules = splitRules(currentPolicy?.networkPolicies).own;

  const isGlobal = effective.data?.policySource === 'GLOBAL';
  const providerRules = isGlobal
    ? {}
    : splitRules(effective.data?.policy?.networkPolicies).provider;
  const isEditable = isWorkspaceAdmin && !isGlobal;

  const latest = policyView.data?.latest;
  const activeVersion = policyView.data?.activeVersion ?? 0;

  // Every change the rules view makes is an operation the gateway merges into
  // the latest policy itself. The policy is never sent back from here, so a
  // field this view does not show cannot be lost by it.
  const merge = (
    operations: PolicyMergeOperation[],
    message: string,
    onDone?: () => void,
  ) => {
    if (operations.length === 0) return;
    mergePolicy.mutate(operations, {
      onSuccess: () => {
        addSuccess(message);
        onDone?.();
      },
    });
  };

  const submitAddEndpoint = (ruleName: string, form: EndpointFormValues) => {
    if (!form.host.trim()) return;
    merge(
      [addEndpointOperation(ruleName, form)],
      `Endpoint ${form.host.trim()}:${form.port} added`,
      () => setAddOpen(false),
    );
  };

  const submitL7Rule = (kind: L7RuleKind, method: string, path: string) => {
    if (!l7Target) return;
    const rule = ownRules[l7Target.ruleName];
    if (!rule) return;
    merge(
      [
        addL7RuleOperation(
          kind,
          l7Target.ruleName,
          rule,
          l7Target.endpoint,
          method,
          path,
        ),
      ],
      `${kind === 'allow' ? 'Allow' : 'Deny'} rule added to ${l7Target.ruleName}`,
      () => setL7Target(null),
    );
  };

  // Replaces the sandbox's policy with a document, where that policy is still
  // the revision the document was started from. What this page holds of the
  // sandbox and what it holds of its policy are read at different paces, so
  // the resource version of the one says nothing about the revision of the
  // other. Both are read again here, the sandbox first: its resource version
  // is then no newer than the revision read after it. A revision that is
  // still the draft's means the policy was the draft's at that version, and
  // the gateway refuses the version if anything has changed the sandbox
  // since, a new policy included.
  const replaceDocument = async (
    policy: SandboxPolicy,
    base: PolicyDraftBase,
    onDone: () => void,
  ) => {
    replacePolicy.reset();
    setNotSentReason(undefined);
    setConfirming(true);
    try {
      const readSandbox = await sandbox.refetch();
      const readPolicy = await policyView.refetch();
      // A sandbox with no revision yet has no policy to read: for a draft
      // that was started from none, that is the policy unchanged.
      const stillNoRevision =
        base.revision === undefined &&
        readPolicy.isError &&
        (readPolicy.error as ApiError).status === 404;
      const failure = readSandbox.isError
        ? readSandbox.error
        : readPolicy.isError && !stillNoRevision
          ? readPolicy.error
          : null;
      if (failure || !readSandbox.data) {
        setNotSentReason(
          `The sandbox could not be read again to confirm that its policy is still the one this document was started from${failure ? ` (${failure.message})` : ''}.`,
        );
        return;
      }
      const revisionNow = stillNoRevision
        ? undefined
        : readPolicy.data?.latest?.version;
      if (revisionNow !== base.revision) {
        // Somebody changed the policy. The view has just read that revision,
        // and the document editor says so and asks what to do with the draft.
        return;
      }
      replacePolicy.mutate(
        {
          policy,
          expectedResourceVersion: readSandbox.data.metadata.resourceVersion,
        },
        {
          onSuccess: (result) => {
            addSuccess(`Policy replaced: revision ${result.version} submitted`);
            onDone();
          },
        },
      );
    } finally {
      setConfirming(false);
    }
  };

  const notFound =
    policyView.isError && (policyView.error as ApiError).status === 404;
  const mergeError = mergePolicy.isError
    ? (mergePolicy.error as Error).message
    : undefined;

  return (
    <Stack hasGutter>
      {isGlobal && (
        <StackItem>
          <Alert
            variant="warning"
            isInline
            title="A gateway-global policy is enforced on this sandbox"
            data-testid="policy-source-global"
          >
            This sandbox is given the gateway-global policy
            {effective.data?.globalPolicyVersion
              ? ` (revision ${effective.data.globalPolicyVersion})`
              : ''}
            , not its own. Its own policy, shown below, is kept and applies
            again once the global policy is deleted. Until then the gateway
            refuses changes to it. The policy in force is under Document,
            Effective policy.
          </Alert>
        </StackItem>
      )}
      {latest?.status === 'PENDING' && (
        <StackItem>
          <Alert
            variant="info"
            isInline
            title={`Revision ${latest.version} is waiting for the sandbox to load it`}
            data-testid="policy-revision-pending"
          >
            The sandbox is still enforcing revision {activeVersion || '-'}. This
            view refreshes until the new revision is loaded or fails.
          </Alert>
        </StackItem>
      )}
      {latest?.status === 'FAILED' && (
        <StackItem>
          <Alert
            variant="danger"
            isInline
            title={`Revision ${latest.version} failed to load`}
            data-testid="policy-revision-failed"
          >
            {latest.loadError || 'The sandbox reported no reason.'} The active
            revision is {activeVersion || '-'}.
            {effective.data?.policyValidationFailureMode &&
              ` The gateway's failure mode for a rejected policy is ${effective.data.policyValidationFailureMode}.`}
          </Alert>
        </StackItem>
      )}
      <StackItem>
        <Toolbar aria-label="Policy view controls">
          <ToolbarContent>
            <ToolbarItem>
              <Label color="blue">Active version: {activeVersion || '-'}</Label>
            </ToolbarItem>
            {latest && (
              <ToolbarItem>
                <Label
                  color={policyStatusColor(latest.status)}
                  icon={policyStatusIcon(latest.status)}
                  data-testid="policy-latest-status"
                >
                  Latest: v{latest.version} {latest.status}
                </Label>
              </ToolbarItem>
            )}
            {effective.data &&
              effective.data.policySource !== 'UNSPECIFIED' && (
                <ToolbarItem>
                  <Label
                    color={isGlobal ? 'orange' : 'grey'}
                    data-testid="policy-source"
                  >
                    Source: {effective.data.policySource.toLowerCase()}
                  </Label>
                </ToolbarItem>
              )}
            <ToolbarItem>
              <ToggleGroup aria-label="View mode">
                <ToggleGroupItem
                  text="Rules"
                  isSelected={viewMode === 'rules'}
                  onChange={() => setViewMode('rules')}
                  data-testid="view-rules"
                />
                <ToggleGroupItem
                  text={documentDraft ? 'Document (unsaved draft)' : 'Document'}
                  isSelected={viewMode === 'document'}
                  onChange={() => setViewMode('document')}
                  data-testid="view-document"
                />
              </ToggleGroup>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </StackItem>

      {viewMode === 'document' ? (
        <StackItem>
          <PolicyDocumentEditor
            policy={currentPolicy}
            effectivePolicy={effective.data?.policy}
            sandboxName={sandboxName}
            canEdit={isWorkspaceAdmin}
            editBlockedReason={isGlobal ? GLOBAL_POLICY_BLOCK : undefined}
            revision={latest?.version}
            draft={documentDraft}
            onDraftChange={(draft) => {
              // A draft that is given up, or sent, takes what was said about
              // sending it with it.
              if (!draft) {
                setNotSentReason(undefined);
                replacePolicy.reset();
              }
              setDocumentDraft(draft);
            }}
            isPending={isConfirming || replacePolicy.isPending}
            error={
              replacePolicy.isError
                ? (replacePolicy.error as Error).message
                : undefined
            }
            notSentReason={notSentReason}
            onReplace={replaceDocument}
          />
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
                {isEditable && (
                  <Toolbar aria-label="Network rule actions">
                    <ToolbarContent>
                      <ToolbarItem>
                        <Button
                          icon={<PlusCircleIcon />}
                          onClick={() => {
                            mergePolicy.reset();
                            setAddOpen(true);
                          }}
                          data-testid="add-endpoint-button"
                        >
                          Add endpoint
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                )}
                <NetworkRulesTable
                  networkRules={ownRules}
                  isEditable={isEditable}
                  isBusy={mergePolicy.isPending}
                  onRemoveRule={(name) =>
                    merge([removeRuleOperation(name)], `Rule "${name}" removed`)
                  }
                  onRemoveEndpoint={(name, endpoint) =>
                    merge(
                      removeEndpointOperations(name, endpoint),
                      `Endpoint ${endpoint.host ?? ''} removed from "${name}"`,
                    )
                  }
                  onAddL7Rule={(ruleName, endpoint) => {
                    mergePolicy.reset();
                    setL7Target({ ruleName, endpoint });
                  }}
                />
                <Content component="small" className="pf-v6-u-mt-sm">
                  Open a rule to see every field it sets. Fields this form has
                  no control for are edited under Document.
                </Content>
              </CardBody>
            </Card>
          </StackItem>

          {Object.keys(providerRules).length > 0 && (
            <StackItem>
              <Card>
                <CardTitle>Rules from attached providers (read-only)</CardTitle>
                <CardBody>
                  <Content component="small">
                    The gateway adds these to what the sandbox enforces, one per
                    attached provider. They are not part of the sandbox&apos;s
                    own policy: attach or detach the provider to change them.
                  </Content>
                  <NetworkRulesTable
                    networkRules={providerRules}
                    isEditable={false}
                    isBusy={false}
                    aria-label="Provider network rules"
                    data-testid="provider-rules-table"
                  />
                </CardBody>
              </Card>
            </StackItem>
          )}
        </>
      )}

      {!notFound && (policyView.data?.revisions ?? []).length > 0 && (
        <StackItem>
          <Title headingLevel="h3">Revision history</Title>
          <PolicyRevisionTable
            revisions={policyView.data?.revisions ?? []}
            activeVersion={activeVersion}
            showLoaded
            showError
            renderDetails={(revision) => (
              <PolicyRevisionDetails revision={revision} />
            )}
          />
        </StackItem>
      )}

      {mergeError && !isAddOpen && !l7Target && (
        <StackItem>
          <Alert
            variant="danger"
            isInline
            title="Policy update failed"
            data-testid="policy-update-error"
          >
            {mergeError}
          </Alert>
        </StackItem>
      )}

      {isAddOpen && (
        <AddEndpointModal
          isOpen
          onClose={() => setAddOpen(false)}
          onSubmit={submitAddEndpoint}
          isPending={mergePolicy.isPending}
          error={mergeError}
        />
      )}
      {l7Target && ownRules[l7Target.ruleName] && (
        <AddL7RuleModal
          ruleName={l7Target.ruleName}
          rule={ownRules[l7Target.ruleName]}
          endpoint={l7Target.endpoint}
          onClose={() => setL7Target(null)}
          onSubmit={submitL7Rule}
          isPending={mergePolicy.isPending}
          error={mergeError}
        />
      )}
    </Stack>
  );
};

export default PolicyRuleEditor;
