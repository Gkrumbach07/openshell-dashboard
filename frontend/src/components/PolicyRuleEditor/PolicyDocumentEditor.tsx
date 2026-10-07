import React, { useMemo, useState } from 'react';
import {
  Alert,
  AlertActionLink,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  Flex,
  FlexItem,
  List,
  ListItem,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import { CodeEditor, Language } from '@patternfly/react-code-editor';

import { usePolicyText } from '../../hooks/usePolicyText';
import { hasGatewayMarks, policyToText } from '../../utils/policyFile';
import type { PolicyFileFormat } from '../../utils/policyFile';
import PolicyDocumentInput from '../policy/PolicyDocumentInput';
import PolicyFormatToggle, {
  POLICY_FORMAT_NOTE,
} from '../policy/PolicyFormatToggle';
import { isProviderRuleName } from './utils';
import type { SandboxPolicy } from '../../types';

// What a draft was started from: the revision of the sandbox's policy that
// the document was read from, and none before the first revision exists. A
// draft replaces that policy and no other. When the policy is found at
// another revision, somebody changed it in the meantime, and sending the
// draft would put the policy back to what it was, plus the edit.
export type PolicyDraftBase = {
  revision?: number;
};

// A policy document being edited, and what it was started from.
export type PolicyDocumentDraft = {
  text: string;
  base: PolicyDraftBase;
};

type PolicyDocumentEditorProps = {
  // The sandbox's own policy: its latest revision. This is what an edit
  // starts from and what a replacement becomes.
  policy: SandboxPolicy | undefined;
  // What the sandbox is given to enforce, when that is something else.
  effectivePolicy?: SandboxPolicy;
  sandboxName: string;
  canEdit: boolean;
  // Why the policy cannot be replaced right now, when it cannot.
  editBlockedReason?: string;
  // The revision `policy` is, as it was last read. It goes on being read
  // while a draft is open.
  revision?: number;
  // The draft, for a caller that keeps it so that it outlives this view.
  // Without `onDraftChange` the draft is kept here, and goes with the view.
  draft?: PolicyDocumentDraft | null;
  onDraftChange?: (draft: PolicyDocumentDraft | null) => void;
  // Sends the document. `base` is what the draft was started from: the
  // caller sends the document only where the policy is still that.
  onReplace: (
    policy: SandboxPolicy,
    base: PolicyDraftBase,
    onDone: () => void,
  ) => void;
  isPending: boolean;
  // Why the gateway refused the document.
  error?: string;
  // Why the document did not get as far as the gateway.
  notSentReason?: string;
};

type DocumentView = 'own' | 'effective';

// The whole policy as a document. This is where every field is visible and
// editable, including the ones the rule form has no control for. It is shown
// and edited in either of two forms: JSON, the policy as the gateway holds it
// (protojson field names), or YAML, the policy file the CLI prints and reads.
// What is saved is the document as typed: a policy file is converted here, as
// the CLI converts it, and the gateway's own schema checks the result.
const PolicyDocumentEditor: React.FC<PolicyDocumentEditorProps> = ({
  policy,
  effectivePolicy,
  sandboxName,
  canEdit,
  editBlockedReason,
  revision,
  draft: keptDraft,
  onDraftChange,
  onReplace,
  isPending,
  error,
  notSentReason,
}) => {
  const [view, setView] = useState<DocumentView>('own');
  const [format, setFormat] = useState<PolicyFileFormat>('json');
  const [ownDraft, setOwnDraft] = useState<PolicyDocumentDraft | null>(null);
  const draft = onDraftChange ? (keptDraft ?? null) : ownDraft;
  const setDraft = onDraftChange ?? setOwnDraft;
  const isEditing = draft !== null;
  const text = draft?.text ?? '';

  const reading = usePolicyText(text);
  const reservedKey = Object.keys(reading.parsed?.networkPolicies ?? {}).find(
    isProviderRuleName,
  );
  let draftErrors: string[] = [];
  if (isEditing) {
    if (!text.trim()) {
      draftErrors = ['The policy document is empty.'];
    } else if (!reading.parsed) {
      draftErrors = reading.diagnostics.map((diagnostic) => diagnostic.message);
    } else if (reservedKey) {
      draftErrors = [
        `The rule "${reservedKey}" is one the gateway composes in for an attached provider. Remove it: a sandbox's own policy cannot define _provider_ rules.`,
      ];
    }
  }
  const hasDraftError = draftErrors.length > 0;

  // The policy as it is now, which is what a draft started now would be
  // started from.
  const current: PolicyDraftBase = { revision };
  // The policy was changed by someone else since the draft was started:
  // sending the draft would put the policy back to what it was, plus the
  // edit. It is not sent until the person editing has said which they want.
  const policyChanged = isEditing && draft.base.revision !== revision;
  const cannotReplace =
    hasDraftError || policyChanged || Boolean(editBlockedReason);

  const shown = view === 'effective' ? effectivePolicy : policy;
  const shownText = useMemo(
    () => (shown ? policyToText(shown, format) : undefined),
    [shown, format],
  );

  // The policy as a document in the format on screen, or in JSON when it
  // cannot be written in that one.
  const documentOf = (source: SandboxPolicy, wanted: PolicyFileFormat) =>
    policyToText(source, wanted).text ??
    policyToText(source, 'json').text ??
    '';

  const startEditing = () => {
    if (!policy) return;
    setView('own');
    setDraft({ text: documentOf(policy, format), base: current });
  };

  return (
    <Card>
      <CardTitle>Policy document</CardTitle>
      <CardBody>
        {!isEditing && (
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            gap={{ default: 'gapMd' }}
            className="pf-v6-u-mb-md"
          >
            <FlexItem>
              <ToggleGroup aria-label="Policy document">
                <ToggleGroupItem
                  text="Sandbox policy"
                  isSelected={view === 'own'}
                  onChange={() => setView('own')}
                  data-testid="document-view-own"
                />
                <ToggleGroupItem
                  text="Effective policy"
                  isSelected={view === 'effective'}
                  isDisabled={!effectivePolicy}
                  onChange={() => setView('effective')}
                  data-testid="document-view-effective"
                />
              </ToggleGroup>
            </FlexItem>
            <FlexItem>
              <PolicyFormatToggle
                format={format}
                onChange={setFormat}
                data-testid="document-format"
              />
            </FlexItem>
            {canEdit && (
              <FlexItem>
                <Button
                  variant="secondary"
                  onClick={startEditing}
                  isDisabled={!policy || Boolean(editBlockedReason)}
                  data-testid="edit-policy-document"
                >
                  Edit or replace
                </Button>
              </FlexItem>
            )}
          </Flex>
        )}
        {!isEditing && (
          <Content component="small" data-testid="policy-document-note">
            {view === 'effective'
              ? 'What the sandbox is given to enforce: its own policy plus the rules the gateway adds for attached providers, or the gateway-global policy while one is set. Read-only.'
              : "The sandbox's own policy, as its latest revision holds it."}{' '}
            {POLICY_FORMAT_NOTE[format]}
            {format === 'yaml' &&
              shown &&
              hasGatewayMarks(shown) &&
              ' A policy file has no field for the marks the gateway puts on an endpoint (providerCredentialed, advisorProposed); those are in the JSON only.'}{' '}
            The download button saves the document as it is shown.
          </Content>
        )}
        {isEditing && (
          <Content component="small">
            Edit the document, paste one, or load one from a .yaml, .yml or
            .json file, and replace the sandbox&apos;s policy with it
            (`openshell policy set --policy`). The network sections are what a
            live sandbox can change: the gateway refuses a document that alters
            the landlock or process sections, or removes anything from the
            filesystem section, of the policy the sandbox started with.
          </Content>
        )}
        {isEditing ? (
          <PolicyDocumentInput
            text={text}
            onChange={(next) => setDraft({ text: next, base: draft.base })}
            reading={reading}
            height="28rem"
            data-testid="policy-document-input"
          />
        ) : shownText && shownText.text === undefined ? (
          <Alert
            variant="warning"
            isInline
            title="This policy cannot be written as a policy file"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-unwritable"
          >
            <List isPlain>
              {shownText.diagnostics.map((diagnostic) => (
                <ListItem key={`${diagnostic.path}:${diagnostic.message}`}>
                  {diagnostic.message}
                </ListItem>
              ))}
            </List>
          </Alert>
        ) : (
          <CodeEditor
            isReadOnly
            isLanguageLabelVisible
            isCopyEnabled
            isDownloadEnabled
            downloadFileName={`${sandboxName}-policy${view === 'effective' ? '-effective' : ''}`}
            code={shownText?.text ?? ''}
            language={format === 'yaml' ? Language.yaml : Language.json}
            height="28rem"
            data-testid="policy-document"
          />
        )}
        {hasDraftError && (
          <Alert
            variant="danger"
            isInline
            title="This document cannot be saved"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-error"
          >
            {draftErrors.length === 1 ? (
              draftErrors[0]
            ) : (
              <List isPlain>
                {draftErrors.map((message) => (
                  <ListItem key={message}>{message}</ListItem>
                ))}
              </List>
            )}
          </Alert>
        )}
        {isEditing && editBlockedReason && (
          <Alert
            variant="warning"
            isInline
            title="The policy cannot be replaced right now"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-blocked"
          >
            {editBlockedReason} The document is kept as it is.
          </Alert>
        )}
        {policyChanged && (
          <Alert
            variant="warning"
            isInline
            title="The sandbox's policy changed while this document was being edited"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-stale"
            actionLinks={
              <>
                <AlertActionLink
                  onClick={() => setDraft({ text, base: current })}
                  data-testid="policy-document-stale-keep"
                >
                  Keep this document
                </AlertActionLink>
                {policy && (
                  <AlertActionLink
                    onClick={() =>
                      setDraft({
                        text: documentOf(policy, reading.format),
                        base: current,
                      })
                    }
                    data-testid="policy-document-stale-discard"
                  >
                    Discard it and start from the policy as it is now
                  </AlertActionLink>
                )}
              </>
            }
          >
            The document was started from{' '}
            {draft.base.revision
              ? `revision ${draft.base.revision}`
              : 'the policy the sandbox was created with'}
            , and the policy is now{' '}
            {revision ? `revision ${revision}` : 'a different one'}. Replacing
            the policy with this document would undo whatever that change was,
            so it is not sent as it stands. Keeping the document means it
            replaces the policy as it is now.
          </Alert>
        )}
        {isEditing && notSentReason && (
          <Alert
            variant="danger"
            isInline
            title="The policy was not sent"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-not-sent"
          >
            {notSentReason} The document is kept as it is.
          </Alert>
        )}
        {isEditing && error && (
          <Alert
            variant="danger"
            isInline
            title="The gateway refused the policy"
            className="pf-v6-u-mt-sm"
            data-testid="policy-document-refused"
          >
            {error}
          </Alert>
        )}
        {isEditing && (
          <Flex gap={{ default: 'gapSm' }} className="pf-v6-u-mt-md">
            <FlexItem>
              <Button
                variant="primary"
                onClick={() => {
                  if (reading.parsed && !cannotReplace) {
                    onReplace(reading.parsed, draft.base, () => setDraft(null));
                  }
                }}
                isDisabled={cannotReplace || isPending}
                isLoading={isPending}
                data-testid="replace-policy"
              >
                Replace policy
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                onClick={() => setDraft(null)}
                isDisabled={isPending}
              >
                Cancel
              </Button>
            </FlexItem>
          </Flex>
        )}
        {!isEditing && editBlockedReason && canEdit && (
          <Content component="small" className="pf-v6-u-mt-sm">
            {editBlockedReason}
          </Content>
        )}
      </CardBody>
    </Card>
  );
};

export default PolicyDocumentEditor;
