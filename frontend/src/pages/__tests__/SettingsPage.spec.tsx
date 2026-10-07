import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import {
  formatSettingValue,
  parseSettingValue,
  settingTypeOf,
} from '../../utils/settings';
import type { GatewaySettings } from '../../types';

const mockSet = jest.fn();
let mockSetState: { isError: boolean; error: Error | null } = {
  isError: false,
  error: null,
};
const mockDelete = jest.fn();
let mockDeleteState: { isError: boolean; error: Error | null } = {
  isError: false,
  error: null,
};
const mockAddSuccess = jest.fn();
const mockAddAlert = jest.fn();

jest.mock('../../api/settings', () => ({
  useGlobalSettings: jest.fn(),
  useSetGlobalSetting: jest.fn(() => ({
    mutate: mockSet,
    reset: jest.fn(),
    isPending: false,
    ...mockSetState,
  })),
  useDeleteGlobalSetting: jest.fn(() => ({
    mutate: mockDelete,
    reset: jest.fn(),
    isPending: false,
    ...mockDeleteState,
  })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addSuccess: mockAddSuccess,
    addAlert: mockAddAlert,
  })),
}));

import { useGlobalSettings } from '../../api/settings';
const mockUseGlobalSettings = useGlobalSettings as jest.Mock;

// What a gateway lists: every setting it knows, typed, and without a value
// for the ones that were never set.
const settings: GatewaySettings = {
  settingsRevision: 4,
  settings: [
    { key: 'agent_policy_proposals_enabled' },
    { key: 'ocsf_json_enabled', value: false },
    { key: 'ocsf_schema_version', value: '' },
    { key: 'proposal_approval_mode', value: 'manual' },
    { key: 'retries', value: 3 },
  ],
};

const renderPage = (data: GatewaySettings = settings) => {
  mockUseGlobalSettings.mockReturnValue({
    isLoading: false,
    isError: false,
    data,
  });
  return render(<SettingsPage />);
};

const row = (key: string) => {
  const found = screen.getByText(key).closest('tr');
  if (!found) {
    throw new Error(`no table row for ${key}`);
  }
  return within(found);
};

// The second step of every write: "Set k = v globally?" has to be answered
// before anything is sent.
const confirmSet = () =>
  fireEvent.click(screen.getByTestId('confirm-set-setting'));

// The gateway refuses the next write for this reason.
const refuseWith = (message: string) =>
  mockSet.mockImplementation(
    (_setting: unknown, options: { onError?: () => void }) => {
      mockSetState = { isError: true, error: new Error(message) };
      options.onError?.();
    },
  );

describe('setting value helpers', () => {
  it('reads the type from the value, and none from a setting that has no value', () => {
    expect(settingTypeOf('manual')).toBe('string');
    expect(settingTypeOf('')).toBe('string');
    expect(settingTypeOf(false)).toBe('boolean');
    expect(settingTypeOf(3)).toBe('integer');
    expect(settingTypeOf(undefined)).toBeUndefined();
  });

  it('shows a set but empty string as a value', () => {
    expect(formatSettingValue(undefined)).toBe('—');
    expect(formatSettingValue('')).toBe('""');
    expect(formatSettingValue(false)).toBe('false');
    expect(formatSettingValue(3)).toBe('3');
    expect(formatSettingValue('manual')).toBe('manual');
  });

  it('reads the control as a value of the chosen type', () => {
    expect(parseSettingValue('boolean', 'true')).toBe(true);
    expect(parseSettingValue('boolean', 'false')).toBe(false);
    expect(parseSettingValue('integer', ' -12 ')).toBe(-12);
    expect(parseSettingValue('integer', '')).toBeUndefined();
    expect(parseSettingValue('integer', '1.5')).toBeUndefined();
    expect(parseSettingValue('integer', '1e3')).toBeUndefined();
    expect(parseSettingValue('integer', '9007199254740993')).toBeUndefined();
    // A string is sent exactly as typed, including text that reads as a bool.
    expect(parseSettingValue('string', 'true')).toBe('true');
    expect(parseSettingValue('string', '')).toBe('');
  });
});

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockReset();
    mockDelete.mockReset();
    mockSetState = { isError: false, error: null };
    mockDeleteState = { isError: false, error: null };
  });

  it('lists each value in its type, and a setting that was never set without one', () => {
    renderPage();
    expect(row('ocsf_json_enabled').getByText('false')).toBeInTheDocument();
    expect(row('retries').getByText('3')).toBeInTheDocument();
    expect(
      row('proposal_approval_mode').getByText('manual'),
    ).toBeInTheDocument();
    expect(row('ocsf_schema_version').getByText('""')).toBeInTheDocument();
    expect(
      row('agent_policy_proposals_enabled').getByText('—'),
    ).toBeInTheDocument();
  });

  // What gateway 0.1.2 answers when nothing was ever set: its four registered
  // keys, each without a value. The dashboard has no list of its own, so this
  // is where the keys a gateway takes are learned from.
  it('lists the keys the gateway knows when none of them is set', () => {
    renderPage({
      settingsRevision: 28,
      settings: [
        { key: 'agent_policy_proposals_enabled' },
        { key: 'ocsf_json_enabled' },
        { key: 'ocsf_schema_version' },
        { key: 'proposal_approval_mode' },
      ],
    });

    for (const key of [
      'agent_policy_proposals_enabled',
      'ocsf_json_enabled',
      'ocsf_schema_version',
      'proposal_approval_mode',
    ]) {
      expect(row(key).getByText('—')).toBeInTheDocument();
      expect(screen.getByTestId(`edit-${key}`)).toBeInTheDocument();
    }
    expect(
      within(screen.getByTestId('settings-table')).getAllByRole('row'),
    ).toHaveLength(5);
    expect(screen.getByText('Settings revision: 28')).toBeInTheDocument();
  });

  it('saves a boolean setting as a boolean', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-ocsf_json_enabled'));

    // The gateway reported the value, so its type is known and not offered.
    expect(
      screen.queryByTestId('edit-value-ocsf_json_enabled-type'),
    ).not.toBeInTheDocument();
    const value = screen.getByTestId('edit-value-ocsf_json_enabled');
    expect(value).toHaveValue('false');
    fireEvent.change(value, { target: { value: 'true' } });
    fireEvent.click(screen.getByTestId('save-ocsf_json_enabled'));
    confirmSet();

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0]).toEqual({
      key: 'ocsf_json_enabled',
      value: true,
    });
  });

  it('asks for the type of a setting that was never set', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-agent_policy_proposals_enabled'));

    expect(
      screen.getByText(/the gateway does not report its type/i),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByTestId('edit-value-agent_policy_proposals_enabled-type'),
      { target: { value: 'boolean' } },
    );
    fireEvent.change(
      screen.getByTestId('edit-value-agent_policy_proposals_enabled'),
      { target: { value: 'true' } },
    );
    fireEvent.click(screen.getByTestId('save-agent_policy_proposals_enabled'));
    confirmSet();

    expect(mockSet.mock.calls[0][0]).toEqual({
      key: 'agent_policy_proposals_enabled',
      value: true,
    });
  });

  it('saves an integer setting as a number and refuses text that is not one', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-retries'));
    const value = screen.getByTestId('edit-value-retries');
    expect(value).toHaveValue(3);

    fireEvent.change(value, { target: { value: '' } });
    expect(screen.getByTestId('save-retries')).toBeDisabled();

    fireEvent.change(value, { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('save-retries'));
    confirmSet();
    expect(mockSet.mock.calls[0][0]).toEqual({ key: 'retries', value: 5 });
  });

  it('saves a string setting as a string, whatever the text reads as', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-proposal_approval_mode'));
    fireEvent.change(screen.getByTestId('edit-value-proposal_approval_mode'), {
      target: { value: 'true' },
    });
    fireEvent.click(screen.getByTestId('save-proposal_approval_mode'));
    confirmSet();

    expect(mockSet.mock.calls[0][0]).toEqual({
      key: 'proposal_approval_mode',
      value: 'true',
    });
  });

  it('shows why the gateway refused an edit', () => {
    mockSetState = {
      isError: true,
      error: new Error("setting 'ocsf_json_enabled' expects bool value"),
    };
    renderPage();
    fireEvent.click(screen.getByTestId('edit-ocsf_json_enabled'));

    expect(
      screen.getByTestId('edit-error-ocsf_json_enabled'),
    ).toHaveTextContent("setting 'ocsf_json_enabled' expects bool value");
  });

  // Adding and editing share one mutation. With both open, a refusal of the
  // add would show under the row being edited as well.
  it('closes a row being edited when Add setting opens', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-proposal_approval_mode'));
    expect(
      screen.getByTestId('edit-value-proposal_approval_mode'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('add-setting'));
    expect(
      screen.queryByTestId('edit-value-proposal_approval_mode'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('new-setting-key')).toBeInTheDocument();
  });

  it('adds a setting in the chosen type', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('add-setting'));
    fireEvent.change(screen.getByTestId('new-setting-key'), {
      target: { value: 'retries' },
    });
    fireEvent.change(screen.getByTestId('new-setting-value-type'), {
      target: { value: 'integer' },
    });
    fireEvent.change(screen.getByTestId('new-setting-value'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByTestId('confirm-add-setting'));
    confirmSet();

    expect(mockSet.mock.calls[0][0]).toEqual({ key: 'retries', value: 7 });
  });
});

// The TUI asks before it applies a global setting: "Set k = v globally? This
// will apply to all sandboxes on this gateway." The page saved at once.
describe('SettingsPage confirmation before a setting is written', () => {
  const question = () => screen.getByTestId('confirm-set-question');
  const editMode = (value: string) => {
    fireEvent.click(screen.getByTestId('edit-proposal_approval_mode'));
    fireEvent.change(screen.getByTestId('edit-value-proposal_approval_mode'), {
      target: { value },
    });
    fireEvent.click(screen.getByTestId('save-proposal_approval_mode'));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockReset();
    mockSetState = { isError: false, error: null };
  });

  it('asks before it writes an edited value, and writes nothing until answered', () => {
    renderPage();

    editMode('auto');

    expect(mockSet).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('confirm-set-modal');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAccessibleName('Confirm global setting change');
    expect(question()).toHaveTextContent(
      'Set proposal_approval_mode = auto globally?',
    );
    expect(dialog).toHaveTextContent(
      'This will apply to all sandboxes on this gateway.',
    );
  });

  it('writes the value once the answer is yes', () => {
    mockSet.mockImplementation(
      (_setting: unknown, options: { onSuccess?: () => void }) =>
        options.onSuccess?.(),
    );
    renderPage();
    editMode('auto');

    confirmSet();

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0]).toEqual({
      key: 'proposal_approval_mode',
      value: 'auto',
    });
    expect(mockAddSuccess).toHaveBeenCalledWith(
      'Setting "proposal_approval_mode" updated',
    );
    expect(screen.queryByTestId('confirm-set-modal')).not.toBeInTheDocument();
    // The row is no longer being edited.
    expect(
      screen.queryByTestId('edit-value-proposal_approval_mode'),
    ).not.toBeInTheDocument();
  });

  it('writes nothing when the answer is no, and leaves the edit as it was', () => {
    renderPage();
    editMode('auto');

    fireEvent.click(screen.getByTestId('cancel-set-setting'));

    expect(mockSet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-set-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('edit-value-proposal_approval_mode')).toHaveValue(
      'auto',
    );
  });

  // The boolean true and the string "true" read alike, and the gateway takes
  // only one of them for a key. The question says which is being sent.
  it.each([
    ['ocsf_json_enabled', 'true', 'ocsf_json_enabled = true', 'a boolean'],
    [
      'proposal_approval_mode',
      'true',
      'proposal_approval_mode = true',
      'a string',
    ],
    ['retries', '9', 'retries = 9', 'an integer'],
    ['ocsf_schema_version', '', 'ocsf_schema_version = ""', 'a string'],
  ])(
    'says what %s is set to and in which type',
    (key, typed, shown, typeName) => {
      renderPage();
      fireEvent.click(screen.getByTestId(`edit-${key}`));
      fireEvent.change(screen.getByTestId(`edit-value-${key}`), {
        target: { value: typed },
      });
      fireEvent.click(screen.getByTestId(`save-${key}`));

      expect(question()).toHaveTextContent(`Set ${shown} globally?`);
      expect(screen.getByTestId('confirm-set-type')).toHaveTextContent(
        `The value is sent as ${typeName}.`,
      );
    },
  );

  const fillAdd = (key: string, value: string) => {
    fireEvent.click(screen.getByTestId('add-setting'));
    fireEvent.change(screen.getByTestId('new-setting-key'), {
      target: { value: key },
    });
    fireEvent.change(screen.getByTestId('new-setting-value'), {
      target: { value },
    });
    fireEvent.click(screen.getByTestId('confirm-add-setting'));
  };

  it('asks before it writes an added setting too', () => {
    renderPage();

    fillAdd(' ocsf_schema_version ', '1.3');

    expect(mockSet).not.toHaveBeenCalled();
    // The key is sent without the spaces around it, and shown that way.
    expect(question()).toHaveTextContent(
      'Set ocsf_schema_version = 1.3 globally?',
    );
    // One dialog at a time: the form makes way for the question.
    expect(screen.queryByTestId('new-setting-key')).not.toBeInTheDocument();

    mockSet.mockImplementation(
      (_setting: unknown, options: { onSuccess?: () => void }) =>
        options.onSuccess?.(),
    );
    confirmSet();
    expect(mockSet.mock.calls[0][0]).toEqual({
      key: 'ocsf_schema_version',
      value: '1.3',
    });
    expect(mockAddSuccess).toHaveBeenCalledWith(
      'Setting "ocsf_schema_version" saved',
    );
    expect(screen.queryByTestId('new-setting-key')).not.toBeInTheDocument();
  });

  it('goes back to the form, as it was filled in, when the answer is no', () => {
    renderPage();
    fillAdd('ocsf_schema_version', '1.3');

    fireEvent.click(screen.getByTestId('cancel-set-setting'));

    expect(mockSet).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-setting-key')).toHaveValue(
      'ocsf_schema_version',
    );
    expect(screen.getByTestId('new-setting-value')).toHaveValue('1.3');
  });

  // The dashboard does not know which values a setting takes: the gateway
  // does, and says so when it refuses one. These are its own words (0.1.2).
  it('shows the gateway refusing an edited value, in its own words, under the row', () => {
    const refusal =
      "setting 'proposal_approval_mode' expects one of [manual, auto]; got 'banana'";
    refuseWith(refusal);
    renderPage();
    editMode('banana');

    confirmSet();

    expect(screen.queryByTestId('confirm-set-modal')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('edit-error-proposal_approval_mode'),
    ).toHaveTextContent(refusal);
    // The value is still there to be corrected.
    expect(screen.getByTestId('edit-value-proposal_approval_mode')).toHaveValue(
      'banana',
    );
    expect(mockAddSuccess).not.toHaveBeenCalled();
  });

  it('shows the gateway refusing an added setting, in its own words, in the form', () => {
    const refusal =
      "unknown setting key 'log_level'. Allowed keys: ocsf_json_enabled, ocsf_schema_version, agent_policy_proposals_enabled, proposal_approval_mode";
    refuseWith(refusal);
    renderPage();
    fillAdd('log_level', 'debug');

    confirmSet();

    expect(screen.getByTestId('add-setting-error')).toHaveTextContent(refusal);
    expect(screen.getByTestId('new-setting-key')).toHaveValue('log_level');
    expect(screen.getByTestId('new-setting-value')).toHaveValue('debug');
  });
});

// The gateway answers a delete with whether there was anything to delete.
describe('SettingsPage delete', () => {
  const answerDeleteWith = (deleted: boolean) =>
    mockDelete.mockImplementation(
      (
        _key: string,
        options: {
          onSuccess?: (result: {
            deleted: boolean;
            settingsRevision: number;
          }) => void;
        },
      ) => options.onSuccess?.({ deleted, settingsRevision: 5 }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockDelete.mockReset();
    mockDeleteState = { isError: false, error: null };
  });

  it('asks before it deletes, and says what a global delete does', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('delete-proposal_approval_mode'));

    expect(mockDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Delete the global setting "proposal_approval_mode"? This will unset the value for all sandboxes on this gateway.',
      ),
    ).toBeInTheDocument();
  });

  it('says a setting was deleted when the gateway deleted it', () => {
    answerDeleteWith(true);
    renderPage();
    fireEvent.click(screen.getByTestId('delete-proposal_approval_mode'));

    fireEvent.click(screen.getByTestId('confirm-delete'));

    expect(mockDelete.mock.calls[0][0]).toBe('proposal_approval_mode');
    expect(mockAddSuccess).toHaveBeenCalledWith(
      'Setting "proposal_approval_mode" deleted',
    );
    expect(mockAddAlert).not.toHaveBeenCalled();
  });

  // A key the gateway lists but that has no global value: there is nothing
  // to delete, and the gateway says so.
  it('says a setting was not set when the gateway had nothing to delete', () => {
    answerDeleteWith(false);
    renderPage();
    fireEvent.click(
      screen.getByTestId('delete-agent_policy_proposals_enabled'),
    );

    fireEvent.click(screen.getByTestId('confirm-delete'));

    expect(mockDelete.mock.calls[0][0]).toBe('agent_policy_proposals_enabled');
    expect(mockAddAlert).toHaveBeenCalledWith(
      'Setting "agent_policy_proposals_enabled" was not set, so nothing was deleted',
    );
    expect(mockAddSuccess).not.toHaveBeenCalled();
  });

  it('shows why the gateway refused a delete', () => {
    mockDeleteState = {
      isError: true,
      error: new Error("role 'openshell-admin' required"),
    };
    renderPage();

    fireEvent.click(screen.getByTestId('delete-proposal_approval_mode'));

    expect(
      screen.getByText("role 'openshell-admin' required"),
    ).toBeInTheDocument();
  });
});

// The settings are re-read while the page is open.
describe('SettingsPage when the settings cannot be read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('puts the error in place of the page when they never loaded', () => {
    mockUseGlobalSettings.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('OpenShell gateway is unreachable'),
      data: undefined,
      refetch: jest.fn(),
    });
    render(<SettingsPage />);

    expect(
      screen.getByText('Failed to load gateway settings'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('OpenShell gateway is unreachable'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('settings-table')).not.toBeInTheDocument();
  });

  // What is being typed must survive a refresh that did not get through.
  it('keeps the settings, and an edit in progress, when a refresh fails', () => {
    const { rerender } = renderPage();
    fireEvent.click(screen.getByTestId('edit-proposal_approval_mode'));
    fireEvent.change(screen.getByTestId('edit-value-proposal_approval_mode'), {
      target: { value: 'auto' },
    });

    const refetch = jest.fn();
    mockUseGlobalSettings.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('OpenShell gateway is unreachable'),
      data: settings,
      refetch,
    });
    rerender(<SettingsPage />);

    const notice = screen.getByTestId('settings-refresh-error');
    expect(notice).toHaveTextContent('The settings could not be refreshed');
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    expect(notice).toHaveTextContent(
      'What is shown was loaded earlier and may be out of date.',
    );
    expect(screen.getByTestId('settings-table')).toBeInTheDocument();
    expect(screen.getByTestId('edit-value-proposal_approval_mode')).toHaveValue(
      'auto',
    );

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says nothing of the kind while refreshes succeed', () => {
    renderPage();

    expect(
      screen.queryByTestId('settings-refresh-error'),
    ).not.toBeInTheDocument();
  });
});
