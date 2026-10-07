import {
  deleteSandboxSetting,
  getSandboxSettings,
  setSandboxSetting,
} from '../sandboxSettings';

jest.mock('../client', () => ({
  get: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

import { del, get, put } from '../client';

const mockGet = get as jest.Mock;
const mockPut = put as jest.Mock;
const mockDel = del as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({});
  mockPut.mockResolvedValue({});
  mockDel.mockResolvedValue({});
});

describe('sandbox settings API', () => {
  it('getSandboxSettings reads the settings of one sandbox in its workspace', async () => {
    await getSandboxSettings('team-a', 'agent-1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings',
    );
  });

  it('setSandboxSetting puts the key and the value in its own JSON type', async () => {
    await setSandboxSetting('team-a', 'agent-1', 'ocsf_json_enabled', true);
    expect(mockPut).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings',
      { key: 'ocsf_json_enabled', value: true },
    );

    await setSandboxSetting('team-a', 'agent-1', 'retries', 3);
    expect(mockPut).toHaveBeenLastCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings',
      { key: 'retries', value: 3 },
    );

    // Text that reads as a boolean stays text: the gateway type-checks.
    await setSandboxSetting('team-a', 'agent-1', 'mode', 'true');
    expect(mockPut).toHaveBeenLastCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings',
      { key: 'mode', value: 'true' },
    );
  });

  it('deleteSandboxSetting names the key in the query string', async () => {
    await deleteSandboxSetting('team-a', 'agent-1', 'proposal_approval_mode');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings?key=proposal_approval_mode',
    );
  });

  it('encodes the workspace, the sandbox and the key', async () => {
    await getSandboxSettings('team a', 'agent/1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/team%20a/sandboxes/agent%2F1/settings',
    );
    await deleteSandboxSetting('team-a', 'agent-1', 'a&b=c');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-1/settings?key=a%26b%3Dc',
    );
  });
});
