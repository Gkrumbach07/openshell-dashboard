import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import CreateSandboxFromTemplateModal from '../CreateSandboxFromTemplateModal';
import CreateSandboxModal from '../CreateSandboxModal';
import { policyTemplates } from '../policy/policyTemplates';
import type { SandboxPolicy } from '../../types';

// The two forms a sandbox is created from take its policy as text. These
// tests drive the real form state through each modal, so what they assert is
// the policy the gateway is sent: for a preset, for a YAML policy file pasted
// over it, and for one loaded from a file.

const mockCreate = jest.fn();
const mockCreateFromTemplate = jest.fn();
let mockProviders: { metadata: { name: string }; type: string }[] = [];

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
    mutate: mockCreate,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/templates', () => ({
  useCreateSandboxFromTemplate: jest.fn(() => ({
    mutate: mockCreateFromTemplate,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: mockProviders })),
}));

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ settings: false })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));

jest.mock('../../api/client', () => ({
  get: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

// Upstream's own example, unchanged: the file a person would paste.
const QUICKSTART = readFileSync(
  join(
    __dirname,
    '../../utils/__tests__/fixtures/policies/examples/sandbox-policy-quickstart/policy.yaml',
  ),
  'utf8',
);

// What that file has to become, worked out by hand from upstream's to_proto
// and confirmed against a real gateway, which stores exactly this for it.
const QUICKSTART_POLICY: SandboxPolicy = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: [
      '/bin',
      '/usr',
      '/lib',
      '/proc',
      '/dev/urandom',
      '/app',
      '/etc',
      '/var/log',
    ],
    readWrite: ['/sandbox', '/tmp', '/dev/null'],
  },
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

// The two modals, and what differs between them for these tests.
const FORMS = [
  {
    form: 'Create sandbox',
    input: 'sandbox-policy-input',
    select: 'sandbox-policy-template-select',
    submit: 'create-sandbox-submit',
    mutate: mockCreate,
    element: () => (
      <CreateSandboxModal workspace="team-a" isOpen onClose={jest.fn()} />
    ),
  },
  {
    form: 'Create sandbox from template',
    input: 'from-template-policy-input',
    select: 'from-template-policy-template-select',
    submit: 'create-from-template-submit',
    mutate: mockCreateFromTemplate,
    element: () => (
      <CreateSandboxFromTemplateModal
        workspace="team-a"
        templateName="claude-harness"
        isOpen
        onClose={jest.fn()}
      />
    ),
  },
];

describe.each(FORMS)(
  '$form: the policy as a file',
  ({ input, select, submit, mutate, element }) => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockProviders = [];
    });

    const text = () => screen.getByTestId(input) as HTMLTextAreaElement;
    const type = (value: string) =>
      fireEvent.change(text(), { target: { value } });
    const help = () => screen.getByTestId(`${input}-help`);
    const button = () => screen.getByTestId(submit);
    const fileName = () =>
      screen.getByLabelText(/filename|policy file here/i) as HTMLInputElement;

    // Chooses a file in the form's file control, as the file dialog does.
    const chooseFile = (name: string, content: string) => {
      const control = screen
        .getByTestId(`${input}-file`)
        .querySelector('input[type="file"]');
      if (!control) throw new Error('the form has no file control');
      fireEvent.change(control, {
        target: { files: [new File([content], name)] },
      });
    };

    // The policy of the one and only request the form sent.
    const sentPolicy = (): SandboxPolicy => {
      expect(mutate).toHaveBeenCalledTimes(1);
      return (mutate.mock.calls[0][0] as { policy: SandboxPolicy }).policy;
    };

    it('still sends the preset it opens on, which is JSON', () => {
      render(element());
      expect(JSON.parse(text().value)).toEqual(policyTemplates[0].policy);
      fireEvent.click(button());
      expect(sentPolicy()).toEqual(policyTemplates[0].policy);
    });

    it('says what format the policy is in', () => {
      render(element());
      expect(help()).toHaveTextContent(
        'A policy file in YAML, the format `openshell sandbox create --policy` reads and `openshell policy get --full` prints, or the policy as JSON.',
      );
    });

    it("creates a sandbox with upstream's quickstart policy when its YAML is pasted", () => {
      render(element());
      type(QUICKSTART);
      expect(button()).toBeEnabled();
      fireEvent.click(button());
      expect(sentPolicy()).toEqual(QUICKSTART_POLICY);
    });

    it('creates a sandbox with the policy of a file that is loaded', async () => {
      render(element());
      chooseFile('policy.yaml', QUICKSTART);
      await waitFor(() => expect(text().value).toBe(QUICKSTART));
      expect(fileName()).toHaveValue('policy.yaml');
      fireEvent.click(button());
      expect(sentPolicy()).toEqual(QUICKSTART_POLICY);
    });

    it('reads a policy file in JSON, and the JSON of the API, as what they are', () => {
      render(element());
      type(
        JSON.stringify({
          version: 1,
          network_policies: {
            web: { endpoints: [{ host: 'a.example', port: 443 }] },
          },
        }),
      );
      fireEvent.click(button());
      expect(sentPolicy()).toEqual({
        version: 1,
        networkPolicies: {
          web: {
            name: 'web',
            endpoints: [{ host: 'a.example', port: 443, ports: [443] }],
          },
        },
      });
    });

    it.each([
      [
        'a field the format does not have',
        QUICKSTART.replace('enforcement: enforce', 'enforcment: enforce'),
        "unknown field 'network_policies.github_api.endpoints[0].enforcment' in authored policy",
      ],
      [
        'a mode there is not',
        QUICKSTART.replace('access: read-only', 'access: readonly'),
        "network policy 'github_api': endpoint 0: unknown access value 'readonly' (expected read-only, read-write, or full)",
      ],
      [
        'the wrong version',
        QUICKSTART.replace('version: 1', 'version: 2'),
        'unsupported policy version 2; expected version 1',
      ],
      ['broken JSON', '{"version": 1,', 'Invalid JSON: '],
    ])(
      'shows the diagnostic and sends nothing for %s',
      (_case, document, message) => {
        render(element());
        type(document);
        expect(help()).toHaveTextContent(message);
        expect(text()).toHaveAttribute('aria-invalid', 'true');
        expect(button()).toBeDisabled();
        fireEvent.click(button());
        expect(mutate).not.toHaveBeenCalled();
      },
    );

    // A policy with nothing in it is not a policy of nothing. An emptied text
    // used to disable Create and say nothing about why.
    it.each([
      [
        'emptied',
        '',
        'A policy is required. Choose a preset, paste a policy, or load one from a file.',
      ],
      [
        'only space',
        '  \n\t\n',
        'A policy is required. Choose a preset, paste a policy, or load one from a file.',
      ],
      [
        'only comments',
        '# rules to come\n\n# and nothing else\n',
        'failed to decode sandbox policy fields: expected a mapping, found null',
      ],
      [
        'a YAML document that is empty',
        '---\n',
        'failed to decode sandbox policy fields: expected a mapping, found null',
      ],
    ])(
      'says why and sends nothing for a policy that is %s',
      (_case, document, message) => {
        render(element());
        type(document);
        expect(help()).toHaveTextContent(message);
        expect(text()).toHaveAttribute('aria-invalid', 'true');
        expect(button()).toBeDisabled();
        fireEvent.click(button());
        expect(mutate).not.toHaveBeenCalled();
      },
    );

    it('shows every diagnostic of a file that has several', () => {
      render(element());
      type(
        QUICKSTART.replace(
          'access: read-only',
          'access: readonly\n        tls: terminate',
        ),
      );
      expect(
        Array.from(
          help().querySelectorAll('.pf-v6-c-helper-text__item-text'),
        ).map((item) => item.firstChild?.textContent),
      ).toEqual([
        "network policy 'github_api': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
        "network policy 'github_api': endpoint 0: unknown access value 'readonly' (expected read-only, read-write, or full)",
      ]);
    });

    it('goes back to a preset when one is chosen after a file', async () => {
      render(element());
      chooseFile('policy.yaml', QUICKSTART);
      await waitFor(() => expect(fileName()).toHaveValue('policy.yaml'));

      const preset = policyTemplates[1];
      fireEvent.change(screen.getByTestId(select), {
        target: { value: preset.id },
      });
      expect(JSON.parse(text().value)).toEqual(preset.policy);
      // The text is no longer that file's, and the form does not say it is.
      expect(fileName()).toHaveValue('');
      fireEvent.click(button());
      expect(sentPolicy()).toEqual(preset.policy);
    });

    it('clears the policy with the file control, and then sends nothing', async () => {
      render(element());
      chooseFile('policy.yaml', QUICKSTART);
      await waitFor(() => expect(text().value).toBe(QUICKSTART));
      // The policy section is closed while its policy is a good one.
      fireEvent.click(
        within(screen.getByTestId(`${input}-file`)).getByRole('button', {
          name: 'Clear',
          hidden: true,
        }),
      );
      expect(text().value).toBe('');
      expect(help()).toHaveTextContent('A policy is required.');
      expect(button()).toBeDisabled();
      fireEvent.click(button());
      expect(mutate).not.toHaveBeenCalled();
    });

    it('refuses a file that is not a policy file by its name', async () => {
      render(element());
      const before = text().value;
      chooseFile('policy.png', 'not a policy');
      await waitFor(() =>
        expect(help()).toHaveTextContent(
          'A policy file is a .yaml, .yml or .json file.',
        ),
      );
      expect(text().value).toBe(before);
    });

    // The providers of the workspace are re-read while the form is open.
    it('keeps what was typed when the form is drawn again by a refresh', () => {
      const { rerender } = render(element());
      type(QUICKSTART);
      mockProviders = [{ metadata: { name: 'claude' }, type: 'claude' }];
      rerender(element());
      expect(screen.getByText('claude (claude)')).toBeInTheDocument();
      expect(text().value).toBe(QUICKSTART);
      fireEvent.click(button());
      expect(sentPolicy()).toEqual(QUICKSTART_POLICY);
    });
  },
);
