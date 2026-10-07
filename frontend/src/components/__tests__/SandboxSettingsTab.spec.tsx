import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SandboxSettingsTab from '../sandbox/SandboxSettingsTab';
import type { SandboxSettings } from '../../types';

const mockSet = jest.fn();
const mockDelete = jest.fn();
const mockAddSuccess = jest.fn();
const mockAddAlert = jest.fn();
let mockSetState: { isError: boolean; error: Error | null } = {
  isError: false,
  error: null,
};
let mockDeleteState: { isError: boolean; error: Error | null } = {
  isError: false,
  error: null,
};
let mockRole = { isWorkspaceAdmin: true };

jest.mock('../../api/sandboxSettings', () => ({
  useSandboxSettings: jest.fn(),
  useSetSandboxSetting: jest.fn(() => ({
    mutate: mockSet,
    reset: jest.fn(),
    isPending: false,
    ...mockSetState,
  })),
  useDeleteSandboxSetting: jest.fn(() => ({
    mutate: mockDelete,
    reset: jest.fn(),
    isPending: false,
    ...mockDeleteState,
  })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => mockRole),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: mockAddAlert,
    addSuccess: mockAddSuccess,
    addDanger: jest.fn(),
  })),
}));

import {
  useDeleteSandboxSetting,
  useSandboxSettings,
  useSetSandboxSetting,
} from '../../api/sandboxSettings';
const mockUseSandboxSettings = useSandboxSettings as jest.Mock;

// What a gateway reports for a sandbox: every setting it knows, with the scope
// each value comes from. One is set on the gateway, two on the sandbox, and
// one nowhere.
const settings: SandboxSettings = {
  policySource: 'SANDBOX',
  policyHash: 'sha256:abc',
  policyVersion: 3,
  globalPolicyVersion: 0,
  configRevision: '18446744073709551615',
  providerEnvRevision: '42',
  policyValidationFailureMode: 'fail_closed',
  settings: [
    { key: 'agent_policy_proposals_enabled', scope: 'UNSPECIFIED' },
    { key: 'ocsf_json_enabled', value: true, scope: 'GLOBAL' },
    { key: 'proposal_approval_mode', value: 'auto', scope: 'SANDBOX' },
    { key: 'retries', value: 3, scope: 'SANDBOX' },
  ],
};

const renderTab = (data: SandboxSettings = settings) => {
  mockUseSandboxSettings.mockReturnValue({
    isLoading: false,
    isError: false,
    data,
  });
  return render(
    <SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />,
  );
};

const row = (key: string) => {
  const found = screen.getByText(key).closest('tr');
  if (!found) {
    throw new Error(`no table row for ${key}`);
  }
  return within(found);
};

describe('SandboxSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetState = { isError: false, error: null };
    mockDeleteState = { isError: false, error: null };
    mockRole = { isWorkspaceAdmin: true };
  });

  it('reads the settings of this sandbox in this workspace', () => {
    renderTab();
    expect(mockUseSandboxSettings).toHaveBeenCalledWith('team-a', 'agent-1');
    expect(useSetSandboxSetting).toHaveBeenCalledWith('team-a', 'agent-1');
    expect(useDeleteSandboxSetting).toHaveBeenCalledWith('team-a', 'agent-1');
  });

  it('lists each key with its value and the scope the value comes from', () => {
    renderTab();
    expect(row('ocsf_json_enabled').getByText('true')).toBeInTheDocument();
    expect(screen.getByTestId('scope-ocsf_json_enabled')).toHaveTextContent(
      'Global',
    );
    expect(row('proposal_approval_mode').getByText('auto')).toBeInTheDocument();
    expect(
      screen.getByTestId('scope-proposal_approval_mode'),
    ).toHaveTextContent('Sandbox');
    expect(row('retries').getByText('3')).toBeInTheDocument();
    // Set nowhere: no value, and the scope says so.
    expect(
      row('agent_policy_proposals_enabled').getByText('—'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('scope-agent_policy_proposals_enabled'),
    ).toHaveTextContent('Not set');
  });

  it('shows where the policy comes from and the configuration it is part of', () => {
    renderTab();
    expect(screen.getByTestId('sandbox-policy-source')).toHaveTextContent(
      'Sandbox',
    );
    expect(screen.getByTestId('sandbox-policy-revision')).toHaveTextContent(
      '3',
    );
    // A 64-bit fingerprint, shown digit for digit.
    expect(screen.getByTestId('sandbox-config-revision')).toHaveTextContent(
      '18446744073709551615',
    );
    expect(screen.getByText('Fail closed')).toBeInTheDocument();
    expect(
      screen.queryByTestId('sandbox-global-policy-note'),
    ).not.toBeInTheDocument();
  });

  it('says so when the sandbox runs the global policy, and shows its revision', () => {
    renderTab({
      ...settings,
      policySource: 'GLOBAL',
      policyVersion: 3,
      globalPolicyVersion: 7,
    });
    expect(screen.getByTestId('sandbox-policy-source')).toHaveTextContent(
      'Global',
    );
    expect(screen.getByTestId('sandbox-policy-revision')).toHaveTextContent(
      '7',
    );
    expect(screen.getByTestId('sandbox-global-policy-note')).toHaveTextContent(
      'This sandbox runs the gateway-global policy',
    );
  });

  it('offers no edit and no delete for a setting that is set on the gateway', () => {
    renderTab();
    // The gateway refuses both while the key is set globally.
    expect(
      screen.queryByTestId('edit-sandbox-ocsf_json_enabled'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('delete-sandbox-ocsf_json_enabled'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('managed-globally-ocsf_json_enabled'),
    ).toHaveTextContent('Managed globally');
    expect(screen.getByTestId('sandbox-settings-scope-note')).toHaveTextContent(
      'A global setting has to be deleted before the key can be set or deleted on a sandbox',
    );
  });

  it('offers edit and delete for a setting that is set on the sandbox', () => {
    renderTab();
    expect(
      screen.getByTestId('edit-sandbox-proposal_approval_mode'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('delete-sandbox-proposal_approval_mode'),
    ).toBeInTheDocument();
  });

  it('offers to set a setting that is set nowhere, and nothing to delete', () => {
    renderTab();
    expect(
      screen.getByTestId('edit-sandbox-agent_policy_proposals_enabled'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('delete-sandbox-agent_policy_proposals_enabled'),
    ).not.toBeInTheDocument();
  });

  it('saves an edited value in the type the setting has', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('edit-sandbox-retries'));
    // The current value is a number, so the type is known and not offered.
    expect(
      screen.queryByTestId('edit-sandbox-value-retries-type'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('edit-sandbox-value-retries'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByTestId('save-sandbox-retries'));
    expect(mockSet).toHaveBeenCalledWith(
      { key: 'retries', value: 5 },
      expect.anything(),
    );
  });

  it('asks for the type of a setting that has no value, and sends that type', () => {
    renderTab();
    fireEvent.click(
      screen.getByTestId('edit-sandbox-agent_policy_proposals_enabled'),
    );
    fireEvent.change(
      screen.getByTestId(
        'edit-sandbox-value-agent_policy_proposals_enabled-type',
      ),
      { target: { value: 'boolean' } },
    );
    fireEvent.change(
      screen.getByTestId('edit-sandbox-value-agent_policy_proposals_enabled'),
      { target: { value: 'true' } },
    );
    fireEvent.click(
      screen.getByTestId('save-sandbox-agent_policy_proposals_enabled'),
    );
    // A JSON boolean, not the string "true".
    expect(mockSet).toHaveBeenCalledWith(
      { key: 'agent_policy_proposals_enabled', value: true },
      expect.anything(),
    );
  });

  it('shows the message of the gateway when it refuses a value', () => {
    const refusal =
      "setting 'proposal_approval_mode' expects one of [manual, auto]; got 'autom'";
    mockSetState = { isError: true, error: new Error(refusal) };
    renderTab();
    fireEvent.click(screen.getByTestId('edit-sandbox-proposal_approval_mode'));
    expect(
      screen.getByTestId('edit-sandbox-error-proposal_approval_mode'),
    ).toHaveTextContent(refusal);
  });

  it('stops offering Save when the key is set on the gateway while it is being edited', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId('edit-sandbox-retries'));
    expect(screen.getByTestId('save-sandbox-retries')).not.toBeDisabled();

    // Somebody sets the key globally; the list is read again.
    mockUseSandboxSettings.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        ...settings,
        settings: settings.settings.map((entry) =>
          entry.key === 'retries'
            ? { ...entry, value: 9, scope: 'GLOBAL' as const }
            : entry,
        ),
      },
    });
    rerender(<SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />);

    expect(screen.getByTestId('scope-retries')).toHaveTextContent('Global');
    expect(screen.getByTestId('save-sandbox-retries')).toBeDisabled();
    fireEvent.click(screen.getByTestId('save-sandbox-retries'));
    fireEvent.submit(screen.getByTestId('edit-sandbox-value-retries'));
    expect(mockSet).not.toHaveBeenCalled();

    // The edit can still be left, and the row then says why it has no controls.
    fireEvent.click(screen.getByTestId('cancel-sandbox-edit-retries'));
    expect(screen.getByTestId('managed-globally-retries')).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-sandbox-retries'),
    ).not.toBeInTheDocument();
  });

  it('deletes a sandbox setting after confirmation', () => {
    mockDelete.mockImplementation((_key, options) =>
      options.onSuccess({ deleted: true, settingsRevision: 4 }),
    );
    renderTab();
    fireEvent.click(
      screen.getByTestId('delete-sandbox-proposal_approval_mode'),
    );
    expect(
      screen.getByText(
        'Setting "proposal_approval_mode" will be removed from sandbox "agent-1", which then follows the gateway default for it.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockDelete).toHaveBeenCalledWith(
      'proposal_approval_mode',
      expect.anything(),
    );
    expect(mockAddSuccess).toHaveBeenCalledWith(
      'Setting "proposal_approval_mode" deleted',
    );
  });

  it('says so when the gateway had nothing to delete', () => {
    mockDelete.mockImplementation((_key, options) =>
      options.onSuccess({ deleted: false, settingsRevision: 4 }),
    );
    renderTab();
    fireEvent.click(screen.getByTestId('delete-sandbox-retries'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockAddSuccess).not.toHaveBeenCalled();
    expect(mockAddAlert).toHaveBeenCalledWith(
      'Setting "retries" was not set on this sandbox',
    );
  });

  it('shows the message of the gateway when it refuses a delete', () => {
    const refusal =
      "setting 'retries' is managed globally; delete the global setting first";
    mockDeleteState = { isError: true, error: new Error(refusal) };
    renderTab();
    fireEvent.click(screen.getByTestId('delete-sandbox-retries'));
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });

  it('adds a setting by key with a typed value', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('add-sandbox-setting'));
    fireEvent.change(screen.getByTestId('new-sandbox-setting-key'), {
      target: { value: ' ocsf_schema_version ' },
    });
    fireEvent.change(screen.getByTestId('new-sandbox-setting-value'), {
      target: { value: '1.3' },
    });
    fireEvent.click(screen.getByTestId('confirm-add-sandbox-setting'));
    expect(mockSet).toHaveBeenCalledWith(
      { key: 'ocsf_schema_version', value: '1.3' },
      expect.anything(),
    );
  });

  it('does not offer to add a key that is set on the gateway', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('add-sandbox-setting'));
    fireEvent.change(screen.getByTestId('new-sandbox-setting-key'), {
      target: { value: 'ocsf_json_enabled' },
    });
    expect(screen.getByTestId('new-sandbox-setting-global')).toHaveTextContent(
      '"ocsf_json_enabled" is set on the gateway, which overrides the sandbox. Delete the global setting to set it here.',
    );
    expect(screen.getByTestId('confirm-add-sandbox-setting')).toBeDisabled();
    fireEvent.click(screen.getByTestId('confirm-add-sandbox-setting'));
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('shows the settings and no controls to someone who is not a workspace admin', () => {
    mockRole = { isWorkspaceAdmin: false };
    renderTab();
    expect(row('proposal_approval_mode').getByText('auto')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sandbox-setting')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-sandbox-proposal_approval_mode'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('delete-sandbox-proposal_approval_mode'),
    ).not.toBeInTheDocument();
  });

  it('shows the error and a retry when the settings cannot be read', () => {
    const refetch = jest.fn();
    mockUseSandboxSettings.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('sandbox not found'),
      refetch,
    });
    render(<SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />);
    expect(
      screen.getByText('Failed to load sandbox settings'),
    ).toBeInTheDocument();
    expect(screen.getByText('sandbox not found')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
  // The settings are polled. React Query reports a refetch that failed as an
  // error beside the data of the last fetch that worked.
  describe('a refresh of the settings that fails', () => {
    const refetch = jest.fn();
    const failRefresh = () =>
      mockUseSandboxSettings.mockReturnValue({
        isLoading: false,
        isError: true,
        error: new Error('bad gateway'),
        data: settings,
        refetch,
      });

    it('leaves the settings on screen, with a note that they may be out of date', () => {
      failRefresh();
      render(<SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />);

      expect(
        screen.getByTestId('sandbox-settings-refresh-error'),
      ).toHaveTextContent('bad gateway');
      expect(screen.getByTestId('sandbox-settings-table')).toBeInTheDocument();
      expect(
        screen.queryByText('Failed to load sandbox settings'),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('keeps a value that is being edited on screen', () => {
      const view = renderTab();
      fireEvent.click(screen.getByTestId('edit-sandbox-retries'));
      fireEvent.change(screen.getByTestId('edit-sandbox-value-retries'), {
        target: { value: '7' },
      });

      failRefresh();
      view.rerender(
        <SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />,
      );

      expect(screen.getByTestId('edit-sandbox-value-retries')).toHaveValue(7);
      expect(screen.getByTestId('save-sandbox-retries')).not.toBeDisabled();
    });

    it('keeps the Add setting form open', () => {
      const view = renderTab();
      fireEvent.click(screen.getByTestId('add-sandbox-setting'));
      fireEvent.change(screen.getByTestId('new-sandbox-setting-key'), {
        target: { value: 'half_typed' },
      });

      failRefresh();
      view.rerender(
        <SandboxSettingsTab workspace="team-a" sandboxName="agent-1" />,
      );

      expect(screen.getByTestId('new-sandbox-setting-key')).toHaveValue(
        'half_typed',
      );
    });
  });
});
