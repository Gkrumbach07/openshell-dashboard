import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import PolicyRuleEditor from '../index';
import type {
  EffectivePolicy,
  PolicyRevision,
  SandboxPolicy,
  SandboxPolicyView,
} from '../../../types';

const mockMerge = jest.fn();
const mockReplace = jest.fn();
let mockMergeState: { isError: boolean; error: Error | null } = {
  isError: false,
  error: null,
};
let mockIsAdmin = true;

jest.mock('../../../api/policy', () => ({
  useSandboxPolicy: jest.fn(),
  useEffectiveSandboxPolicy: jest.fn(),
  useMergeSandboxPolicy: jest.fn(() => ({
    mutate: mockMerge,
    reset: jest.fn(),
    isPending: false,
    ...mockMergeState,
  })),
  useUpdateSandboxPolicy: jest.fn(() => ({
    mutate: mockReplace,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

// The sandbox is read again before a policy document is sent, and answers
// what it did the first time.
jest.mock('../../../api/sandboxes', () => ({
  useSandbox: jest.fn(() => {
    const data = { metadata: { resourceVersion: 7 }, spec: {} };
    return { data, refetch: async () => ({ data, isError: false }) };
  }),
}));

jest.mock('../../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: mockIsAdmin })),
}));

jest.mock('../../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

// Monaco does not run under jsdom. A textarea stands in for the editor: it
// shows the code it is given and reports what is typed the way the editor
// does, through onChange and through onCodeChange, which is the one that also
// fires for a file that is loaded.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    language,
    onChange,
    onCodeChange,
    isReadOnly,
    'data-testid': testId,
  }: {
    code: string;
    language?: string;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    isReadOnly?: boolean;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      data-language={language}
      value={code}
      readOnly={isReadOnly}
      onChange={(event) => {
        onChange?.(event.target.value);
        onCodeChange?.(event.target.value);
      }}
    />
  ),
}));

import {
  useEffectiveSandboxPolicy,
  useSandboxPolicy,
} from '../../../api/policy';
const mockUseSandboxPolicy = useSandboxPolicy as jest.Mock;
const mockUseEffective = useEffectiveSandboxPolicy as jest.Mock;

// A policy that uses what the rule form has no control for: several ports, a
// path scope, explicit allow and deny rules with matchers, a credential
// binding, an MCP endpoint that pins protocol revisions, and middleware.
const richPolicy: SandboxPolicy = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: ['/usr'],
    readWrite: ['/sandbox'],
  },
  process: { runAsUser: 'sandbox', runAsGroup: 'sandbox' },
  networkPolicies: {
    api: {
      name: 'internal-api',
      endpoints: [
        {
          host: 'api.example.com',
          port: 443,
          ports: [443, 8443],
          protocol: 'rest',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
          path: '/v1/**',
          allowEncodedSlash: true,
          credentialBinding: { provider: 'vault' },
          rules: [
            {
              allow: {
                method: 'GET',
                path: '/v1/models/**',
                query: { page: { glob: '1*' } },
              },
            },
          ],
          denyRules: [{ method: 'DELETE', path: '/v1/models/**' }],
        },
      ],
      binaries: [{ path: '/usr/bin/curl' }, { path: '/usr/bin/python3' }],
    },
    mcp: {
      name: 'versioned_mcp',
      endpoints: [
        {
          host: 'mcp.example.com',
          port: 443,
          protocol: 'mcp',
          jsonRpcMaxBodyBytes: 131072,
          mcp: {
            strictToolNames: false,
            versions: ['2025-03-26', '2025-06-18'],
          },
          rules: [{ allow: { method: 'initialize' } }],
        },
      ],
    },
  },
  networkMiddlewares: {
    redact: {
      name: 'redact',
      middleware: 'body-redactor',
      onError: 'deny',
      order: 5,
      config: { pattern: 'sk-.*' },
      endpoints: { include: ['*.example.com'] },
    },
  },
};

const revision = (overrides: Partial<PolicyRevision>): PolicyRevision => ({
  version: 2,
  status: 'LOADED',
  policyHash: 'abcdef0123456789',
  createdAtMs: 1_700_000_000_000,
  loadedAtMs: 1_700_000_005_000,
  policy: richPolicy,
  ...overrides,
});

const viewWith = (latest: PolicyRevision, activeVersion = 2) => ({
  activeVersion,
  latest,
  revisions: [
    revision({
      version: 1,
      status: 'SUPERSEDED',
      policy: { version: 1, networkPolicies: {} },
      provenance: { source: 'create' },
    }),
    latest,
  ],
});

const renderEditor = (
  view: SandboxPolicyView = viewWith(revision({})),
  effective: Partial<EffectivePolicy> = {},
) => {
  mockUseSandboxPolicy.mockReturnValue({
    data: view,
    isError: false,
    refetch: async () => ({ data: view, isError: false }),
  });
  mockUseEffective.mockReturnValue({
    data: {
      policy: richPolicy,
      version: view.latest?.version ?? 0,
      policySource: 'SANDBOX',
      ...effective,
    },
  });
  return render(<PolicyRuleEditor workspace="team-a" sandboxName="sb1" />);
};

const expandRow = (testId: string) =>
  fireEvent.click(
    within(screen.getByTestId(testId)).getByRole('button', { name: 'Details' }),
  );

// A toggle group item carries its test id on a wrapper around the button.
const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('PolicyRuleEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMergeState = { isError: false, error: null };
    mockIsAdmin = true;
  });

  describe('changes made in the rules view', () => {
    // The property that makes the form safe to use on a policy it does not
    // fully understand: it never sends the policy. Each change is an
    // operation the gateway merges, so there is nothing to drop.
    it('adds an endpoint as one operation, without sending the policy', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('add-endpoint-button'));
      fireEvent.change(screen.getByTestId('endpoint-host-input'), {
        target: { value: 'docs.example.com' },
      });
      fireEvent.change(screen.getByTestId('endpoint-binary-input'), {
        target: { value: '/usr/bin/curl' },
      });
      fireEvent.click(screen.getByTestId('submit-add-endpoint'));

      expect(mockMerge).toHaveBeenCalledTimes(1);
      expect(mockMerge.mock.calls[0][0]).toEqual([
        {
          addRule: {
            ruleName: 'allow_docs_example_com_443',
            rule: {
              name: 'allow_docs_example_com_443',
              endpoints: [
                {
                  host: 'docs.example.com',
                  port: 443,
                  ports: [443],
                  protocol: 'rest',
                  access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
                  enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
                },
              ],
              binaries: [{ path: '/usr/bin/curl' }],
            },
          },
        },
      ]);
      expect(mockReplace).not.toHaveBeenCalled();
      // Nothing of the rules that were already there is in the request.
      const sent = JSON.stringify(mockMerge.mock.calls[0][0]);
      expect(sent).not.toContain('api.example.com');
      expect(sent).not.toContain('mcp.example.com');
    });

    it('offers only the protocols --add-endpoint takes, and no access preset where none applies', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('add-endpoint-button'));
      const protocol = screen.getByTestId('endpoint-protocol-select');
      expect(
        within(protocol)
          .getAllByRole('option')
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(['rest', 'websocket', 'sql', 'tcp', '']);

      fireEvent.change(screen.getByTestId('endpoint-host-input'), {
        target: { value: 'db.example.com' },
      });
      fireEvent.change(protocol, { target: { value: 'tcp' } });
      expect(screen.getByTestId('endpoint-access-select')).toBeDisabled();
      expect(screen.getByTestId('endpoint-enforcement-select')).toBeDisabled();
      fireEvent.click(screen.getByTestId('submit-add-endpoint'));

      expect(mockMerge.mock.calls[0][0][0].addRule.rule.endpoints).toEqual([
        { host: 'db.example.com', port: 443, ports: [443], protocol: 'tcp' },
      ]);
    });

    it('removes a rule by name', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('remove-rule-mcp'));
      expect(mockMerge.mock.calls[0][0]).toEqual([
        { removeRule: { ruleName: 'mcp' } },
      ]);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('removes an endpoint on every port it covers', () => {
      renderEditor();
      expandRow('network-rule-api');
      fireEvent.click(screen.getByTestId('endpoint-api-0-remove'));
      // Nothing is sent before the question that says what will be removed
      // has been answered.
      expect(mockMerge).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('confirm-remove-endpoint'));
      expect(mockMerge.mock.calls[0][0]).toEqual([
        {
          removeEndpoint: {
            ruleName: 'api',
            host: 'api.example.com',
            port: 443,
          },
        },
        {
          removeEndpoint: {
            ruleName: 'api',
            host: 'api.example.com',
            port: 8443,
          },
        },
      ]);
    });

    it("appends a request rule and declares the endpoint's whole scope", () => {
      renderEditor();
      expandRow('network-rule-api');
      fireEvent.click(screen.getByTestId('endpoint-api-0-add-l7-rule'));
      fireEvent.change(screen.getByTestId('l7-method-input'), {
        target: { value: 'post' },
      });
      fireEvent.change(screen.getByTestId('l7-path-input'), {
        target: { value: '/v1/chat/**' },
      });
      fireEvent.click(screen.getByTestId('submit-add-l7-rule'));

      expect(mockMerge.mock.calls[0][0]).toEqual([
        {
          addAllowRules: {
            target: {
              ruleName: 'api',
              host: 'api.example.com',
              ports: [443, 8443],
              path: '/v1/**',
              binaries: [
                { path: '/usr/bin/curl' },
                { path: '/usr/bin/python3' },
              ],
            },
            rules: [{ allow: { method: 'POST', path: '/v1/chat/**' } }],
          },
        },
      ]);
    });

    it('offers request rules on REST and WebSocket endpoints only', () => {
      renderEditor();
      expandRow('network-rule-mcp');
      expect(screen.getByTestId('endpoint-mcp-0-remove')).toBeInTheDocument();
      expect(
        screen.queryByTestId('endpoint-mcp-0-add-l7-rule'),
      ).not.toBeInTheDocument();
    });

    it("shows the gateway's reason when it refuses a merge", () => {
      mockMergeState = {
        isError: true,
        error: new Error(
          "adding binary '/usr/bin/curl' would let it reach every endpoint of rule 'api'",
        ),
      };
      renderEditor();
      expect(screen.getByTestId('policy-update-error')).toHaveTextContent(
        "would let it reach every endpoint of rule 'api'",
      );
    });
  });

  describe('what a rule shows', () => {
    it('shows every field of an opened rule, including the ones the form cannot set', () => {
      renderEditor();
      expandRow('network-rule-api');
      const details = screen.getByTestId('endpoint-api-0');
      expect(details).toHaveTextContent(
        'api.example.com:443,8443 /v1/** rest enforce',
      );
      expect(details).toHaveTextContent('GET /v1/models/** query page');
      expect(details).toHaveTextContent('DELETE /v1/models/**');
      expect(details).toHaveTextContent('allowEncodedSlash, credentialBinding');
      // The rule exactly as the gateway holds it.
      expect(
        JSON.parse(screen.getByTestId('rule-json-api').textContent ?? ''),
      ).toEqual(richPolicy.networkPolicies?.api);

      expandRow('network-rule-mcp');
      expect(
        JSON.parse(screen.getByTestId('rule-json-mcp').textContent ?? ''),
      ).toEqual(richPolicy.networkPolicies?.mcp);
    });
  });

  describe('the policy document', () => {
    const openEditor = () => {
      clickToggle('view-document');
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      return screen.getByTestId('policy-document-input') as HTMLTextAreaElement;
    };

    it('shows the whole policy, nothing left out', () => {
      renderEditor();
      clickToggle('view-document');
      const shown = screen.getByTestId(
        'policy-document',
      ) as HTMLTextAreaElement;
      expect(shown).toHaveAttribute('readonly');
      expect(JSON.parse(shown.value)).toEqual(richPolicy);
    });

    // The round trip for the one path that does send the policy back: change
    // one rule in the document and everything else is in the request exactly
    // as it was read, fields the form has no control for included.
    it('replaces the policy with the document as edited, every other field intact', async () => {
      renderEditor();
      const editor = openEditor();
      const edited = clone(richPolicy);
      const endpoint = edited.networkPolicies?.api.endpoints?.[0];
      if (!endpoint) throw new Error('fixture has no api endpoint');
      endpoint.enforcement = 'NETWORK_ENFORCEMENT_MODE_AUDIT';
      fireEvent.change(editor, {
        target: { value: JSON.stringify(edited, null, 2) },
      });
      fireEvent.click(screen.getByTestId('replace-policy'));

      // The sandbox and its policy are read again before the document goes.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      const sent = mockReplace.mock.calls[0][0];
      expect(sent.expectedResourceVersion).toBe(7);
      expect(sent.policy).toEqual(edited);

      // And only the one field differs from what was read.
      const restored = clone(sent.policy) as SandboxPolicy;
      const restoredEndpoint = restored.networkPolicies?.api.endpoints?.[0];
      if (!restoredEndpoint) throw new Error('request has no api endpoint');
      restoredEndpoint.enforcement = 'NETWORK_ENFORCEMENT_MODE_ENFORCE';
      expect(restored).toEqual(richPolicy);
      expect(sent.policy.networkPolicies.mcp).toEqual(
        richPolicy.networkPolicies?.mcp,
      );
      expect(sent.policy.networkMiddlewares).toEqual(
        richPolicy.networkMiddlewares,
      );
      expect(mockMerge).not.toHaveBeenCalled();
    });

    it('starts the edit from the sandbox policy, not from the effective one', () => {
      // The effective policy carries rules the gateway composed in. Sent
      // back, the gateway would refuse them.
      renderEditor(undefined, {
        policy: {
          ...richPolicy,
          networkPolicies: {
            ...richPolicy.networkPolicies,
            _provider_claude: {
              name: '_provider_claude',
              endpoints: [
                {
                  host: 'api.anthropic.com',
                  port: 443,
                  providerCredentialed: true,
                },
              ],
            },
          },
        },
      });
      clickToggle('view-document');
      clickToggle('document-view-effective');
      expect(
        (screen.getByTestId('policy-document') as HTMLTextAreaElement).value,
      ).toContain('_provider_claude');

      fireEvent.click(screen.getByTestId('edit-policy-document'));
      const editor = screen.getByTestId(
        'policy-document-input',
      ) as HTMLTextAreaElement;
      expect(editor.value).not.toContain('_provider_');
      expect(JSON.parse(editor.value)).toEqual(richPolicy);
    });

    it('does not send a document that is not a policy it could save', () => {
      renderEditor();
      const editor = openEditor();

      fireEvent.change(editor, { target: { value: '{"version": 1,' } });
      expect(screen.getByTestId('policy-document-error')).toHaveTextContent(
        'Invalid JSON',
      );
      expect(screen.getByTestId('replace-policy')).toBeDisabled();

      fireEvent.change(editor, {
        target: {
          value: JSON.stringify({
            version: 1,
            networkPolicies: { _provider_claude: { endpoints: [] } },
          }),
        },
      });
      expect(screen.getByTestId('policy-document-error')).toHaveTextContent(
        '_provider_claude',
      );
      expect(screen.getByTestId('replace-policy')).toBeDisabled();

      fireEvent.change(editor, { target: { value: '[]' } });
      expect(screen.getByTestId('replace-policy')).toBeDisabled();
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('what is enforced', () => {
    it('lists the rules the gateway adds for providers apart, and read-only', () => {
      renderEditor(undefined, {
        policy: {
          ...richPolicy,
          networkPolicies: {
            ...richPolicy.networkPolicies,
            _provider_claude: {
              name: '_provider_claude',
              endpoints: [{ host: 'api.anthropic.com', port: 443 }],
            },
          },
        },
      });
      const provider = screen.getByTestId('provider-rules-table');
      expect(provider).toHaveTextContent('_provider_claude');
      expect(provider).toHaveTextContent('api.anthropic.com:443');
      expect(
        within(provider).queryByTestId('remove-rule-_provider_claude'),
      ).not.toBeInTheDocument();
      // And not among the sandbox's own rules.
      expect(screen.getByTestId('network-rules-table')).not.toHaveTextContent(
        '_provider_claude',
      );
    });

    it('says so when a global policy is enforced instead, and stops offering edits', () => {
      renderEditor(undefined, {
        policySource: 'GLOBAL',
        globalPolicyVersion: 4,
        policy: { version: 1, networkPolicies: {} },
      });
      expect(screen.getByTestId('policy-source-global')).toHaveTextContent(
        'revision 4',
      );
      expect(screen.getByTestId('policy-source')).toHaveTextContent(
        'Source: global',
      );
      expect(
        screen.queryByTestId('add-endpoint-button'),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('remove-rule-api')).not.toBeInTheDocument();
      // The sandbox's own rules are still shown: they come back into force
      // when the global policy goes.
      expect(screen.getByTestId('network-rule-api')).toBeInTheDocument();

      clickToggle('view-document');
      expect(screen.getByTestId('edit-policy-document')).toBeDisabled();
    });

    it('reports a revision the sandbox has not loaded yet', () => {
      renderEditor(viewWith(revision({ version: 3, status: 'PENDING' })));
      expect(screen.getByTestId('policy-revision-pending')).toHaveTextContent(
        'still enforcing revision 2',
      );
      expect(screen.getByTestId('policy-latest-status')).toHaveTextContent(
        'Latest: v3 PENDING',
      );
    });

    it('reports a revision that failed to load, with the reason', () => {
      renderEditor(
        viewWith(
          revision({
            version: 3,
            status: 'FAILED',
            loadError: 'unknown protocol ftp',
          }),
        ),
        { policyValidationFailureMode: 'retain_last_valid' },
      );
      const alert = screen.getByTestId('policy-revision-failed');
      expect(alert).toHaveTextContent('unknown protocol ftp');
      expect(alert).toHaveTextContent('The active revision is 2');
      expect(alert).toHaveTextContent('retain_last_valid');
    });
  });

  describe('revision history', () => {
    it('marks the active revision and opens any revision to its payload', () => {
      renderEditor();
      const table = screen.getByTestId('policy-revisions-table');
      expect(
        within(screen.getByTestId('policy-revisions-table-row-2')).getByTestId(
          'policy-revisions-table-active',
        ),
      ).toBeInTheDocument();
      expect(
        within(
          screen.getByTestId('policy-revisions-table-row-1'),
        ).queryByTestId('policy-revisions-table-active'),
      ).not.toBeInTheDocument();
      expect(table).toHaveTextContent('SUPERSEDED');

      expandRow('policy-revisions-table-row-1');
      const first = screen.getByTestId('policy-revision-1');
      expect(first).toHaveTextContent('source');
      expect(first).toHaveTextContent('create');
      expect(
        JSON.parse(
          screen.getByTestId('policy-revision-1-payload').textContent ?? '',
        ),
      ).toEqual({ version: 1, networkPolicies: {} });

      expandRow('policy-revisions-table-row-2');
      expect(
        JSON.parse(
          screen.getByTestId('policy-revision-2-payload').textContent ?? '',
        ),
      ).toEqual(richPolicy);
    });
  });

  it('offers no way to change the policy to someone who may not', () => {
    mockIsAdmin = false;
    renderEditor();
    expect(screen.queryByTestId('add-endpoint-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-rule-api')).not.toBeInTheDocument();
    expandRow('network-rule-api');
    expect(
      screen.queryByTestId('endpoint-api-0-remove'),
    ).not.toBeInTheDocument();
    clickToggle('view-document');
    expect(
      screen.queryByTestId('edit-policy-document'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('policy-document')).toBeInTheDocument();
  });
});
