import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { parse as parseYaml } from 'yaml';

import GlobalPolicyPage from '../GlobalPolicyPage';
import { downloadText } from '../../utils/download';
import { parsePolicyFile } from '../../utils/policyFile';
import type {
  PolicyRevision,
  SandboxPolicy,
  SandboxPolicyView,
} from '../../types';

// The global policy in the two forms it is read and written in: the gateway's
// JSON, and the YAML policy file `openshell policy set --global --policy`
// takes.

const mockSet = jest.fn();

jest.mock('../../api/policy', () => ({
  useGlobalPolicy: jest.fn(),
  useGlobalPolicyRevision: jest.fn(),
  useSetGlobalPolicy: jest.fn(() => ({
    mutate: mockSet,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useDeleteGlobalPolicy: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

jest.mock('../../utils/download', () => ({ downloadText: jest.fn() }));

// Monaco does not run under jsdom. Textareas stand in for the editor: one for
// what is typed, which the editor reports through onChange and onCodeChange,
// and one for a file being loaded, which it reports through onCodeChange
// alone.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    language,
    isUploadEnabled,
    onChange,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    language?: string;
    isUploadEnabled?: boolean;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <>
      <textarea
        data-testid={testId}
        data-language={language}
        value={code}
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

import { useGlobalPolicy, useGlobalPolicyRevision } from '../../api/policy';
const mockUseGlobalPolicy = useGlobalPolicy as jest.Mock;
const mockUseRevision = useGlobalPolicyRevision as jest.Mock;
const mockDownload = downloadText as jest.Mock;

const ceiling: SandboxPolicy = {
  version: 1,
  filesystem: { includeWorkdir: true, readOnly: ['/usr'], readWrite: ['/tmp'] },
  networkPolicies: {
    registry: {
      name: 'registry',
      endpoints: [
        {
          host: 'registry.example.com',
          port: 443,
          ports: [443, 5000],
          protocol: 'rest',
          rules: [{ allow: { method: 'GET', path: '/v2/**' } }],
        },
      ],
    },
  },
};

// A policy file, and the policy it has to become.
const FILE = `# The ceiling for every sandbox.
version: 1
filesystem_policy:
  include_workdir: true
  read_only: [/usr, /lib, /etc]
  read_write: [/tmp]
network_policies:
  github_api:
    name: github-api-readonly
    endpoints:
      - host: api.github.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-only
    binaries:
      - { path: /usr/bin/curl }
`;

const FILE_POLICY: SandboxPolicy = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: ['/usr', '/lib', '/etc'],
    readWrite: ['/tmp'],
  },
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

const viewOf = (activeVersion: number): SandboxPolicyView => {
  const newest: PolicyRevision = {
    version: 2,
    status: 'LOADED',
    policyHash: 'aaaabbbbccccdddd',
    createdAtMs: 1_700_000_000_000,
    policy: ceiling,
  };
  return { activeVersion, latest: newest, revisions: [newest] };
};

const setView = (view: SandboxPolicyView) =>
  mockUseGlobalPolicy.mockReturnValue({
    isLoading: false,
    isError: false,
    data: view,
  });

const renderPage = (view: SandboxPolicyView = viewOf(2)) => {
  setView(view);
  mockUseRevision.mockReturnValue({
    isLoading: false,
    isError: false,
    data: undefined,
  });
  return render(<GlobalPolicyPage />);
};

const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

const editor = () =>
  screen.getByTestId('global-policy-input') as HTMLTextAreaElement;

const type = (value: string) =>
  fireEvent.change(editor(), { target: { value } });

const load = (value: string) =>
  fireEvent.change(screen.getByTestId('global-policy-input-upload'), {
    target: { value },
  });

const apply = () => screen.getByTestId('confirm-global-policy');

// The policy the one and only Apply sent.
const sentPolicy = (): SandboxPolicy => {
  expect(mockSet).toHaveBeenCalledTimes(1);
  return mockSet.mock.calls[0][0] as SandboxPolicy;
};

describe('GlobalPolicyPage formats', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('the policy in force', () => {
    it('is shown as the policy file the CLI prints when YAML is chosen', () => {
      renderPage();
      const shown = () =>
        screen.getByTestId('current-global-policy').textContent ?? '';
      expect(JSON.parse(shown())).toEqual(ceiling);

      clickToggle('current-global-policy-format-yaml');
      expect(parseYaml(shown())).toEqual({
        version: 1,
        filesystem_policy: {
          include_workdir: true,
          read_only: ['/usr'],
          read_write: ['/tmp'],
        },
        network_policies: {
          registry: {
            name: 'registry',
            endpoints: [
              {
                host: 'registry.example.com',
                ports: [443, 5000],
                protocol: 'rest',
                rules: [{ allow: { method: 'GET', path: '/v2/**' } }],
              },
            ],
          },
        },
      });
      expect(
        screen.getByTestId('current-global-policy-format-note'),
      ).toHaveTextContent('openshell policy get --full');
    });

    it('is saved in either format, as a file that reads back to it', () => {
      renderPage();
      fireEvent.click(screen.getByTestId('current-global-policy-download'));
      expect(mockDownload).toHaveBeenLastCalledWith(
        'global-policy.json',
        JSON.stringify(ceiling, null, 2),
        'application/json',
      );

      clickToggle('current-global-policy-format-yaml');
      fireEvent.click(screen.getByTestId('current-global-policy-download'));
      const [name, saved] = mockDownload.mock.calls[1];
      expect(name).toBe('global-policy.yaml');
      expect(parsePolicyFile(saved)).toEqual({
        policy: ceiling,
        diagnostics: [],
      });
    });

    it('is shown as YAML in the revision that holds it too', () => {
      renderPage();
      fireEvent.click(
        within(screen.getByTestId('global-policy-table-row-2')).getByRole(
          'button',
          { name: 'Details' },
        ),
      );
      const payload = () =>
        screen.getByTestId('policy-revision-2-payload').textContent ?? '';
      expect(JSON.parse(payload())).toEqual(ceiling);
      clickToggle('policy-revision-2-payload-format-yaml');
      expect(parsePolicyFile(payload()).policy).toEqual(ceiling);
    });
  });

  describe('the editor', () => {
    const open = () => fireEvent.click(screen.getByTestId('set-global-policy'));

    it("opens on the gateway's JSON, and says what each format is", () => {
      renderPage();
      open();
      expect(editor()).toHaveAttribute('data-language', 'json');
      expect(JSON.parse(editor().value)).toEqual(ceiling);
      expect(
        screen.getByTestId('global-policy-input-format-note'),
      ).toHaveTextContent("JSON is the policy as the gateway's API holds it");

      clickToggle('global-policy-input-format-yaml');
      expect(editor()).toHaveAttribute('data-language', 'yaml');
      expect(parsePolicyFile(editor().value).policy).toEqual(ceiling);
      expect(
        screen.getByTestId('global-policy-input-format-note'),
      ).toHaveTextContent('openshell policy set --policy');
    });

    it('applies the policy a YAML document converts to', () => {
      renderPage();
      open();
      type(FILE);
      expect(editor()).toHaveAttribute('data-language', 'yaml');
      fireEvent.click(apply());
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });

    // A loaded file used to be shown in the editor and not applied: the
    // editor reports it through onCodeChange only.
    it('applies a file that was loaded, not the document it replaced', () => {
      renderPage();
      open();
      load(FILE);
      expect(editor().value).toBe(FILE);
      fireEvent.click(apply());
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });

    it.each([
      [
        'a field the format does not have',
        FILE.replace('enforcement: enforce', 'enforcment: enforce'),
        "unknown field 'network_policies.github_api.endpoints[0].enforcment' in authored policy",
      ],
      [
        'a TLS mode upstream has removed',
        FILE.replace('access: read-only', 'tls: terminate'),
        "network policy 'github_api': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
      ],
      ['text that is neither YAML nor JSON', '{"version": 1,', 'Invalid JSON'],
    ])(
      'shows the diagnostic and applies nothing for %s',
      (_case, document, message) => {
        renderPage();
        open();
        load(document);
        expect(
          screen.getByTestId('global-policy-document-error'),
        ).toHaveTextContent(message);
        expect(apply()).toBeDisabled();
        fireEvent.click(apply());
        expect(mockSet).not.toHaveBeenCalled();
      },
    );

    // An emptied editor used to apply `{}`, a policy of nothing, to every
    // sandbox. A document with nothing in it is not applied, whether it is
    // empty outright or is YAML that says nothing.
    it.each([
      ['an emptied editor', '', 'The policy document is empty.'],
      ['only space', '   \n\t\n', 'The policy document is empty.'],
      [
        'only comments',
        '# the ceiling, to be written\n\n# and nothing else\n',
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
    ])('does not apply a document that is %s', (_case, document, message) => {
      renderPage();
      open();
      type(document);
      expect(
        screen.getByTestId('global-policy-document-error'),
      ).toHaveTextContent(message);
      expect(apply()).toBeDisabled();
      fireEvent.click(apply());
      expect(mockSet).not.toHaveBeenCalled();
    });

    // The page re-reads the global policy while it is open.
    it('keeps the draft when the policy behind it is read again', () => {
      const { rerender } = renderPage();
      open();
      load(FILE);

      // Another revision arrives from the gateway.
      const next = viewOf(3);
      next.latest = { ...(next.latest as PolicyRevision), version: 3 };
      next.revisions = [next.latest, ...next.revisions];
      setView(next);
      rerender(<GlobalPolicyPage />);

      expect(screen.getByTestId('global-policy-in-force')).toHaveTextContent(
        'revision 3 is in force',
      );
      expect(editor().value).toBe(FILE);
      fireEvent.click(apply());
      expect(sentPolicy()).toEqual(FILE_POLICY);
    });
  });
});
