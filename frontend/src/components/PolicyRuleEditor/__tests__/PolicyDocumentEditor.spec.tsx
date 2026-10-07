import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { parse as parseYaml } from 'yaml';

import PolicyDocumentEditor from '../PolicyDocumentEditor';
import { parsePolicyFile } from '../../../utils/policyFile';
import type { SandboxPolicy } from '../../../types';

// Monaco does not run under jsdom. Textareas stand in for the editor: one for
// what is typed, which the editor reports through onChange and onCodeChange,
// and one for a file being loaded, which it reports through onCodeChange
// alone.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    language,
    isReadOnly,
    isUploadEnabled,
    isDownloadEnabled,
    downloadFileName,
    onChange,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    language?: string;
    isReadOnly?: boolean;
    isUploadEnabled?: boolean;
    isDownloadEnabled?: boolean;
    downloadFileName?: string;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <>
      <textarea
        data-testid={testId}
        data-language={language}
        // The name the editor's own download button saves under: this and
        // the extension of the language.
        data-download={
          isDownloadEnabled ? `${downloadFileName}.${language}` : undefined
        }
        value={code}
        readOnly={isReadOnly}
        onChange={(event) => {
          onChange?.(event.target.value);
          onCodeChange?.(event.target.value);
        }}
      />
      {isUploadEnabled && (
        <textarea
          data-testid={`${testId}-upload`}
          value=""
          onChange={(event) => onCodeChange?.(event.target.value)}
        />
      )}
    </>
  ),
}));

// A policy in the form the gateway returns one: named rules, and `port`
// beside `ports`.
const OWN: SandboxPolicy = {
  version: 1,
  filesystem: { includeWorkdir: true, readOnly: ['/usr'], readWrite: ['/tmp'] },
  landlock: { compatibility: 'best_effort' },
  networkPolicies: {
    github_api: {
      name: 'github-api-readonly',
      endpoints: [
        {
          host: 'api.github.com',
          port: 443,
          ports: [443],
          protocol: 'rest',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
        },
      ],
      binaries: [{ path: '/usr/bin/curl' }],
    },
  },
};

const EFFECTIVE: SandboxPolicy = {
  ...OWN,
  networkPolicies: {
    ...OWN.networkPolicies,
    _provider_claude: {
      name: '_provider_claude',
      endpoints: [
        { host: 'api.anthropic.com', port: 443, providerCredentialed: true },
      ],
    },
  },
};

// A policy file that changes the network section of OWN and nothing else.
const FILE = `# from a file
version: 1
filesystem_policy:
  include_workdir: true
  read_only: [/usr]
  read_write: [/tmp]
landlock:
  compatibility: best_effort
network_policies:
  pypi:
    endpoints:
      - host: pypi.org
        ports: [443, 8443]
        protocol: rest
        access: read-only
`;

const FILE_POLICY: SandboxPolicy = {
  version: 1,
  filesystem: { includeWorkdir: true, readOnly: ['/usr'], readWrite: ['/tmp'] },
  landlock: { compatibility: 'best_effort' },
  networkPolicies: {
    pypi: {
      name: 'pypi',
      endpoints: [
        {
          host: 'pypi.org',
          port: 443,
          ports: [443, 8443],
          protocol: 'rest',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
        },
      ],
    },
  },
};

const onReplace = jest.fn();

const renderEditor = (
  props: Partial<React.ComponentProps<typeof PolicyDocumentEditor>> = {},
) =>
  render(
    <PolicyDocumentEditor
      policy={OWN}
      effectivePolicy={EFFECTIVE}
      sandboxName="demo"
      canEdit
      onReplace={onReplace}
      isPending={false}
      {...props}
    />,
  );

const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

const shown = () =>
  screen.getByTestId('policy-document') as HTMLTextAreaElement;

const draft = () =>
  screen.getByTestId('policy-document-input') as HTMLTextAreaElement;

const type = (value: string) =>
  fireEvent.change(draft(), { target: { value } });

const load = (value: string) =>
  fireEvent.change(screen.getByTestId('policy-document-input-upload'), {
    target: { value },
  });

// The policy the one and only Replace sent.
const sentPolicy = (): SandboxPolicy => {
  expect(onReplace).toHaveBeenCalledTimes(1);
  return onReplace.mock.calls[0][0] as SandboxPolicy;
};

describe('PolicyDocumentEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('reading the document', () => {
    it("shows the gateway's JSON until YAML is chosen, and says which is which", () => {
      renderEditor();
      expect(JSON.parse(shown().value)).toEqual(OWN);
      expect(shown()).toHaveAttribute('data-language', 'json');
      expect(screen.getByTestId('policy-document-note')).toHaveTextContent(
        "JSON is the policy as the gateway's API holds it",
      );

      clickToggle('document-format-yaml');
      expect(shown()).toHaveAttribute('data-language', 'yaml');
      expect(parseYaml(shown().value)).toEqual({
        version: 1,
        filesystem_policy: {
          include_workdir: true,
          read_only: ['/usr'],
          read_write: ['/tmp'],
        },
        landlock: { compatibility: 'best_effort' },
        network_policies: {
          github_api: {
            name: 'github-api-readonly',
            endpoints: [
              {
                host: 'api.github.com',
                port: 443,
                protocol: 'rest',
                enforcement: 'enforce',
                access: 'read-only',
              },
            ],
            binaries: [{ path: '/usr/bin/curl' }],
          },
        },
      });
      const note = screen.getByTestId('policy-document-note');
      expect(note).toHaveTextContent('openshell policy get --full');
      expect(note).toHaveTextContent('openshell sandbox create --policy');
      expect(note).toHaveTextContent('openshell policy set --policy');
    });

    it('saves the document under the extension of the format it is shown in', () => {
      renderEditor();
      expect(shown()).toHaveAttribute('data-download', 'demo-policy.json');
      clickToggle('document-format-yaml');
      expect(shown()).toHaveAttribute('data-download', 'demo-policy.yaml');
      // What is saved is what is shown, and it is a file the CLI's own
      // reading of a policy file accepts: it reads back to the same policy.
      expect(parsePolicyFile(shown().value)).toEqual({
        policy: OWN,
        diagnostics: [],
      });

      clickToggle('document-view-effective');
      expect(shown()).toHaveAttribute(
        'data-download',
        'demo-policy-effective.yaml',
      );
    });

    it('says what the YAML of the effective policy leaves out', () => {
      renderEditor();
      clickToggle('document-view-effective');
      expect(shown().value).toContain('providerCredentialed');
      expect(screen.getByTestId('policy-document-note')).not.toHaveTextContent(
        'A policy file has no field',
      );

      clickToggle('document-format-yaml');
      expect(shown().value).toContain('_provider_claude');
      expect(shown().value).not.toMatch(/provider_?credentialed/i);
      expect(screen.getByTestId('policy-document-note')).toHaveTextContent(
        'A policy file has no field for the marks the gateway puts on an endpoint (providerCredentialed, advisorProposed); those are in the JSON only.',
      );
    });

    it('says why a policy cannot be written as a policy file', () => {
      renderEditor({
        policy: {
          version: 1,
          networkPolicies: {
            api: {
              endpoints: [
                { host: 'a.example', tls: 'NETWORK_TLS_MODE_TERMINATE' },
              ],
            },
          },
        },
      });
      clickToggle('document-format-yaml');
      expect(screen.queryByTestId('policy-document')).not.toBeInTheDocument();
      expect(
        screen.getByTestId('policy-document-unwritable'),
      ).toHaveTextContent(
        "network policy 'api': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
      );
      // An edit of it starts from the JSON, which is all there is.
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      expect(draft()).toHaveAttribute('data-language', 'json');
      expect(JSON.parse(draft().value).networkPolicies.api).toBeDefined();
    });
  });

  describe('editing the document', () => {
    it('starts the edit in the format on screen', () => {
      renderEditor();
      clickToggle('document-format-yaml');
      const yaml = shown().value;
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      expect(draft().value).toBe(yaml);
      expect(draft()).toHaveAttribute('data-language', 'yaml');
    });

    it('replaces the policy with what a YAML document converts to', () => {
      renderEditor();
      clickToggle('document-format-yaml');
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      type(draft().value.replace('access: read-only', 'access: read-write'));
      fireEvent.click(screen.getByTestId('replace-policy'));

      const expected = JSON.parse(JSON.stringify(OWN)) as SandboxPolicy;
      const endpoint = expected.networkPolicies?.github_api.endpoints?.[0];
      if (!endpoint) throw new Error('fixture has no endpoint');
      endpoint.access = 'NETWORK_ACCESS_PRESET_READ_WRITE';
      // The one field that was edited, and nothing else, differs from what
      // was read.
      expect(sentPolicy()).toEqual(expected);
    });

    it('sends the JSON document as it was typed, as it always did', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      const edited = { ...OWN, networkPolicies: {} };
      type(JSON.stringify(edited));
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(sentPolicy()).toEqual(edited);
    });

    // A loaded file used to be shown in the editor and not sent: the editor
    // reports it through onCodeChange only.
    it('sends a file that was loaded, YAML or JSON, whatever the draft was', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      expect(draft()).toHaveAttribute('data-language', 'json');

      load(FILE);
      expect(draft().value).toBe(FILE);
      expect(draft()).toHaveAttribute('data-language', 'yaml');
      expect(
        screen.queryByTestId('policy-document-error'),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });

    it('reads a policy file in JSON as the same policy', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      load(
        JSON.stringify({
          version: 1,
          filesystem_policy: {
            include_workdir: true,
            read_only: ['/usr'],
            read_write: ['/tmp'],
          },
          landlock: { compatibility: 'best_effort' },
          network_policies: {
            pypi: {
              endpoints: [
                {
                  host: 'pypi.org',
                  ports: [443, 8443],
                  protocol: 'rest',
                  access: 'read-only',
                },
              ],
            },
          },
        }),
      );
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });

    it('rewrites the draft in the other format, and sends the same policy', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      load(FILE);
      clickToggle('policy-document-input-format-json');
      expect(JSON.parse(draft().value)).toEqual(FILE_POLICY);
      clickToggle('policy-document-input-format-yaml');
      expect(draft()).toHaveAttribute('data-language', 'yaml');
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });

    it.each([
      [
        'a field the format does not have',
        FILE.replace('protocol: rest', 'protocl: rest'),
        "unknown field 'network_policies.pypi.endpoints[0].protocl' in authored policy",
      ],
      [
        'a mode there is not',
        FILE.replace('access: read-only', 'access: readonly'),
        "network policy 'pypi': endpoint 0: unknown access value 'readonly' (expected read-only, read-write, or full)",
      ],
      [
        'a value of the wrong type',
        FILE.replace('ports: [443, 8443]', 'ports: https'),
        'failed to decode sandbox policy fields: network_policies.pypi.endpoints[0].ports: expected a list, found string "https"',
      ],
      [
        'text that is not YAML',
        `${FILE}  broken: [\n`,
        'failed to parse sandbox policy YAML: ',
      ],
      [
        'no version',
        FILE.replace('version: 1\n', ''),
        'failed to decode sandbox policy fields: missing field `version`',
      ],
    ])(
      'shows the diagnostic and sends nothing for a YAML document with %s',
      (_case, document, message) => {
        renderEditor();
        fireEvent.click(screen.getByTestId('edit-policy-document'));
        load(document);
        expect(screen.getByTestId('policy-document-error')).toHaveTextContent(
          message,
        );
        expect(screen.getByTestId('replace-policy')).toBeDisabled();
        fireEvent.click(screen.getByTestId('replace-policy'));
        expect(onReplace).not.toHaveBeenCalled();
      },
    );

    it('lists every diagnostic of a document that has several', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      load(
        FILE.replace(
          'access: read-only',
          'access: readonly\n        enforcement: enforced\n        tls: terminate',
        ),
      );
      const items = within(
        screen.getByTestId('policy-document-error'),
      ).getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual([
        "network policy 'pypi': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
        "network policy 'pypi': endpoint 0: unknown enforcement value 'enforced' (expected enforce or audit)",
        "network policy 'pypi': endpoint 0: unknown access value 'readonly' (expected read-only, read-write, or full)",
      ]);
      expect(screen.getByTestId('replace-policy')).toBeDisabled();
    });

    it('refuses a provider rule in a YAML document as it does in a JSON one', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      load(
        'version: 1\nnetwork_policies:\n  _provider_claude:\n    endpoints:\n      - host: api.anthropic.com\n        port: 443\n',
      );
      expect(screen.getByTestId('policy-document-error')).toHaveTextContent(
        'The rule "_provider_claude" is one the gateway composes in for an attached provider.',
      );
      expect(screen.getByTestId('replace-policy')).toBeDisabled();
    });

    // A document with nothing in it is not a policy of nothing: nothing is
    // sent for it, whether it is empty outright or is YAML that says nothing.
    it.each([
      ['an emptied editor', '', 'The policy document is empty.'],
      ['only space', '   \n\t\n', 'The policy document is empty.'],
      [
        'only comments',
        '# network rules to come\n\n# and nothing else\n',
        'failed to decode sandbox policy fields: expected a mapping, found null',
      ],
      [
        'a YAML document that is empty',
        '---\n',
        'failed to decode sandbox policy fields: expected a mapping, found null',
      ],
      [
        'a YAML null',
        '~\n',
        'failed to decode sandbox policy fields: expected a mapping, found null',
      ],
    ])('does not send a document that is %s', (_case, document, message) => {
      renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      type(document);
      expect(screen.getByTestId('policy-document-error')).toHaveTextContent(
        message,
      );
      expect(screen.getByTestId('replace-policy')).toBeDisabled();
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(onReplace).not.toHaveBeenCalled();
    });

    // The policy view behind the editor is re-read while it is open.
    it('keeps the draft when the policy behind it is read again', () => {
      const { rerender } = renderEditor();
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      load(FILE);
      rerender(
        <PolicyDocumentEditor
          policy={JSON.parse(JSON.stringify(OWN))}
          effectivePolicy={JSON.parse(JSON.stringify(EFFECTIVE))}
          sandboxName="demo"
          canEdit
          onReplace={onReplace}
          isPending={false}
        />,
      );
      expect(draft().value).toBe(FILE);
      fireEvent.click(screen.getByTestId('replace-policy'));
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });
  });
});
