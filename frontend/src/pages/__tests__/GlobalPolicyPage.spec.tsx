import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GlobalPolicyPage from '../GlobalPolicyPage';
import { policyTemplates } from '../../components/policy/policyTemplates';
import type {
  PolicyRevision,
  SandboxPolicy,
  SandboxPolicyView,
} from '../../types';

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

// Monaco does not run under jsdom. A textarea stands in for the editor and
// reports what is typed the way the editor does: through onChange and through
// onCodeChange, which is the one that also fires for a file that is loaded.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    language,
    onChange,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    language?: string;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      data-language={language}
      value={code}
      onChange={(event) => {
        onChange?.(event.target.value);
        onCodeChange?.(event.target.value);
      }}
    />
  ),
}));

import { useGlobalPolicy, useGlobalPolicyRevision } from '../../api/policy';
const mockUseGlobalPolicy = useGlobalPolicy as jest.Mock;
const mockUseRevision = useGlobalPolicyRevision as jest.Mock;

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

const older: SandboxPolicy = { version: 1, networkPolicies: {} };

// What the BFF returns: newest first, the policy on the newest revision only.
const viewOf = (
  latest: Partial<PolicyRevision>,
  activeVersion: number,
): SandboxPolicyView => {
  const newest: PolicyRevision = {
    version: 2,
    status: 'LOADED',
    policyHash: 'aaaabbbbccccdddd',
    createdAtMs: 1_700_000_000_000,
    policy: ceiling,
    ...latest,
  };
  return {
    activeVersion,
    latest: newest,
    revisions: [
      newest,
      {
        version: 1,
        status: 'SUPERSEDED',
        policyHash: '1111222233334444',
        createdAtMs: 1_690_000_000_000,
      },
    ],
  };
};

const renderPage = (view: SandboxPolicyView) => {
  mockUseGlobalPolicy.mockReturnValue({
    isLoading: false,
    isError: false,
    data: view,
  });
  mockUseRevision.mockImplementation((version: number, enabled: boolean) =>
    enabled && version === 1
      ? {
          isLoading: false,
          isError: false,
          data: { ...view.revisions[1], policy: older },
        }
      : { isLoading: false, isError: false, data: undefined },
  );
  return render(<GlobalPolicyPage />);
};

describe('GlobalPolicyPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the policy in force and which revision it is', () => {
    renderPage(viewOf({}, 2));
    expect(screen.getByTestId('global-policy-in-force')).toHaveTextContent(
      'revision 2 is in force',
    );
    expect(
      JSON.parse(screen.getByTestId('current-global-policy').textContent ?? ''),
    ).toEqual(ceiling);
    expect(
      within(screen.getByTestId('global-policy-table-row-2')).getByTestId(
        'global-policy-table-active',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('delete-global-policy')).toBeInTheDocument();
    expect(screen.getByTestId('set-global-policy')).toHaveTextContent(
      'Update global policy',
    );
  });

  // Deleting a global policy leaves its revisions behind. A history is not a
  // policy in force, and there is nothing to delete.
  it('does not take a history of deleted policies for a policy in force', () => {
    renderPage(viewOf({ status: 'SUPERSEDED' }, 0));
    expect(screen.getByTestId('global-policy-not-in-force')).toHaveTextContent(
      'No global policy is in force',
    );
    expect(
      screen.queryByTestId('global-policy-in-force'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('delete-global-policy'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('current-global-policy'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('global-policy-table-active'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('global-policy-table')).toHaveTextContent(
      'SUPERSEDED',
    );
    expect(screen.getByTestId('set-global-policy')).toHaveTextContent(
      'Set global policy',
    );
  });

  // An update that started from a starter template would replace the policy
  // in force with one that allows no network at all.
  it('starts an update from the policy in force and sends back what was edited', () => {
    renderPage(viewOf({}, 2));
    fireEvent.click(screen.getByTestId('set-global-policy'));
    const editor = screen.getByTestId(
      'global-policy-input',
    ) as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(ceiling);
    expect(
      screen.queryByTestId('global-policy-seed-template'),
    ).not.toBeInTheDocument();

    const edited = JSON.parse(JSON.stringify(ceiling));
    edited.networkPolicies.registry.endpoints[0].rules.push({
      allow: { method: 'HEAD', path: '/v2/**' },
    });
    fireEvent.change(editor, { target: { value: JSON.stringify(edited) } });
    fireEvent.click(screen.getByTestId('confirm-global-policy'));
    expect(mockSet.mock.calls[0][0]).toEqual(edited);
  });

  it('says so when the editor has to start from a template instead', () => {
    renderPage(viewOf({ policy: undefined }, 2));
    fireEvent.click(screen.getByTestId('set-global-policy'));
    expect(screen.getByTestId('global-policy-seed-template')).toHaveTextContent(
      'not the policy in force',
    );
    expect(
      JSON.parse(
        (screen.getByTestId('global-policy-input') as HTMLTextAreaElement)
          .value,
      ),
    ).toEqual(policyTemplates[0].policy);
  });

  it('opens an older revision to its payload, read when it is opened', () => {
    renderPage(viewOf({}, 2));
    expect(mockUseRevision).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByTestId('global-policy-table-row-1')).getByRole(
        'button',
        { name: 'Details' },
      ),
    );
    expect(mockUseRevision).toHaveBeenCalledWith(1, true);
    expect(
      JSON.parse(
        screen.getByTestId('policy-revision-1-payload').textContent ?? '',
      ),
    ).toEqual(older);

    // The newest revision already carries its policy: no second read.
    fireEvent.click(
      within(screen.getByTestId('global-policy-table-row-2')).getByRole(
        'button',
        { name: 'Details' },
      ),
    );
    expect(mockUseRevision).toHaveBeenCalledWith(2, false);
    expect(
      JSON.parse(
        screen.getByTestId('policy-revision-2-payload').textContent ?? '',
      ),
    ).toEqual(ceiling);
  });

  it('has nothing to list on a gateway that never had a global policy', () => {
    mockUseGlobalPolicy.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { activeVersion: 0, revisions: [] },
    });
    render(<GlobalPolicyPage />);
    expect(
      screen.getByTestId('global-policy-not-in-force'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('global-policy-table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('set-global-policy'));
    expect(screen.getByTestId('global-policy-seed-template')).toHaveTextContent(
      'no earlier global policy',
    );
  });
});
