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

jest.mock('../../api/settings', () => ({
  useGlobalSettings: jest.fn(),
  useSetGlobalSetting: jest.fn(() => ({
    mutate: mockSet,
    reset: jest.fn(),
    isPending: false,
    ...mockSetState,
  })),
  useDeleteGlobalSetting: jest.fn(() => ({
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

const renderPage = () => {
  mockUseGlobalSettings.mockReturnValue({
    isLoading: false,
    isError: false,
    data: settings,
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
    mockSetState = { isError: false, error: null };
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
    expect(mockSet.mock.calls[0][0]).toEqual({ key: 'retries', value: 5 });
  });

  it('saves a string setting as a string, whatever the text reads as', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('edit-proposal_approval_mode'));
    fireEvent.change(screen.getByTestId('edit-value-proposal_approval_mode'), {
      target: { value: 'true' },
    });
    fireEvent.click(screen.getByTestId('save-proposal_approval_mode'));

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

    expect(mockSet.mock.calls[0][0]).toEqual({ key: 'retries', value: 7 });
  });
});
