import type { CreateSandboxRequest } from '../../types';
import {
  listSandboxes,
  getSandbox,
  createSandbox,
  deleteSandbox,
  getSandboxLogs,
} from '../sandboxes';
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  deleteWorkspace,
  listMembers,
  addMember,
  removeMember,
} from '../workspaces';
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listProviderProfiles,
  getProviderProfile,
  importProviderProfiles,
  updateProviderProfile,
  deleteProviderProfile,
  lintProviderProfiles,
} from '../providers';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  createSandboxFromTemplate,
} from '../templates';
import { getGatewayInfo } from '../gateway';
import { getAuthConfig, getCurrentUser } from '../auth';
import {
  getInferenceRoute,
  setInferenceRoute,
  deleteInferenceRoute,
} from '../inference';
import {
  getSandboxPolicy,
  getGlobalPolicy,
  getDraftPolicy,
  approveDraftChunk,
  rejectDraftChunk,
} from '../policy';
import {
  getGlobalSettings,
  setGlobalSetting,
  deleteGlobalSetting,
} from '../settings';

jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

import { get, post, put, del, apiFetch } from '../client';

const mockGet = get as jest.Mock;
const mockPost = post as jest.Mock;
const mockPut = put as jest.Mock;
const mockDel = del as jest.Mock;
const mockApiFetch = apiFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue([]);
  mockPost.mockResolvedValue({});
  mockPut.mockResolvedValue({});
  mockDel.mockResolvedValue({});
  mockApiFetch.mockResolvedValue({});
});

describe('sandboxes API', () => {
  it('listSandboxes calls correct path', async () => {
    await listSandboxes('default');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes',
    );
  });

  it('listSandboxes passes label selector', async () => {
    await listSandboxes('default', 'team=ml');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes?labelSelector=team%3Dml',
    );
  });

  it('getSandbox calls correct path', async () => {
    await getSandbox('default', 'my-sandbox');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/my-sandbox',
    );
  });

  it('createSandbox posts to correct path', async () => {
    const body = {
      image: 'python',
      policy: { version: 1, networkPolicies: {} },
    };
    await createSandbox('ws1', body as CreateSandboxRequest);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/ws1/sandboxes',
      body,
    );
  });

  it('deleteSandbox calls correct path', async () => {
    await deleteSandbox('default', 'my-sandbox');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/my-sandbox',
    );
  });

  it('getSandboxLogs builds query params', async () => {
    await getSandboxLogs('default', 'sb1', {
      lines: 100,
      level: 'error',
      sources: ['gateway'],
    });
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/default/sandboxes/sb1/logs'),
    );
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain('lines=100');
    expect(url).toContain('level=error');
    expect(url).toContain('source=gateway');
  });

  it('getSandboxLogs with no filters calls without query string', async () => {
    await getSandboxLogs('default', 'sb1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/logs',
    );
  });
});

describe('workspaces API', () => {
  it('listWorkspaces calls correct path', async () => {
    await listWorkspaces();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workspaces');
  });

  it('getWorkspace calls correct path', async () => {
    await getWorkspace('my-ws');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workspaces/my-ws');
  });

  it('createWorkspace posts to correct path', async () => {
    await createWorkspace({ name: 'new-ws' });
    expect(mockPost).toHaveBeenCalledWith('/api/v1/workspaces', {
      name: 'new-ws',
    });
  });

  it('deleteWorkspace calls correct path', async () => {
    await deleteWorkspace('old-ws');
    expect(mockDel).toHaveBeenCalledWith('/api/v1/workspaces/old-ws');
  });

  it('listMembers calls correct path', async () => {
    await listMembers('default');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workspaces/default/members');
  });

  it('addMember posts to correct path', async () => {
    await addMember('default', { principalSubject: 'user1', role: 'USER' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/members',
      {
        principalSubject: 'user1',
        role: 'USER',
      },
    );
  });

  it('removeMember calls correct path', async () => {
    await removeMember('default', 'user1');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/members/user1',
    );
  });
});

describe('providers API', () => {
  it('listProviders calls correct path', async () => {
    await listProviders('default');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/providers',
    );
  });

  it('getProvider calls correct path', async () => {
    await getProvider('default', 'claude');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/providers/claude',
    );
  });

  it('createProvider posts to correct path', async () => {
    const body = { name: 'claude', type: 'claude' };
    await createProvider('default', body);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/providers',
      body,
    );
  });

  it('updateProvider puts to correct path', async () => {
    await updateProvider('default', 'claude', { config: { key: 'val' } });
    expect(mockPut).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/providers/claude',
      { config: { key: 'val' } },
    );
  });

  it('deleteProvider calls correct path', async () => {
    await deleteProvider('default', 'claude');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/providers/claude',
    );
  });

  it('listProviderProfiles calls correct path', async () => {
    await listProviderProfiles('default');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles',
    );
  });

  it('getProviderProfile calls correct path', async () => {
    await getProviderProfile('default', 'claude');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles/claude',
    );
  });

  it('importProviderProfiles posts to correct path', async () => {
    const profiles = [
      {
        id: 'custom-llm',
        displayName: 'Custom LLM',
        category: 'INFERENCE' as const,
        inferenceCapable: true,
      },
    ];
    await importProviderProfiles('default', profiles);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles',
      { profiles },
    );
  });

  it('updateProviderProfile puts to correct path', async () => {
    const profile = {
      id: 'custom-llm',
      displayName: 'Updated',
      category: 'INFERENCE' as const,
      inferenceCapable: true,
    };
    await updateProviderProfile('default', 'custom-llm', profile, 1);
    expect(mockPut).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles/custom-llm',
      { profile, expectedResourceVersion: 1 },
    );
  });

  it('deleteProviderProfile calls correct path', async () => {
    await deleteProviderProfile('default', 'custom-llm');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles/custom-llm',
    );
  });

  it('lintProviderProfiles posts to lint path', async () => {
    const profiles = [
      {
        id: 'test',
        displayName: 'Test',
        category: 'OTHER' as const,
        inferenceCapable: false,
      },
    ];
    await lintProviderProfiles('default', profiles);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/provider-profiles/lint',
      { profiles },
    );
  });

  it('encodes special characters in profile id', async () => {
    await getProviderProfile('my workspace', 'my/profile');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/my%20workspace/provider-profiles/my%2Fprofile',
    );
  });
});

describe('gateway API', () => {
  it('getGatewayInfo calls correct path', async () => {
    await getGatewayInfo();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/gateway');
  });
});

describe('auth API', () => {
  it('getAuthConfig calls correct path', async () => {
    await getAuthConfig();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/config');
  });

  it('getCurrentUser calls correct path', async () => {
    await getCurrentUser();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/whoami');
  });
});

describe('inference API', () => {
  it('getInferenceRoute calls correct path', async () => {
    await getInferenceRoute('default', '');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/inference',
    );
  });

  it('getInferenceRoute with named route', async () => {
    await getInferenceRoute('default', 'sandbox-system');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/inference?route=sandbox-system',
    );
  });

  it('setInferenceRoute puts to correct path', async () => {
    const body = { providerName: 'claude', modelId: 'claude-3' };
    await setInferenceRoute('default', body);
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/inference',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('deleteInferenceRoute calls correct path', async () => {
    await deleteInferenceRoute('default', '');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/inference',
    );
  });
});

describe('policy API', () => {
  it('getSandboxPolicy calls correct path', async () => {
    await getSandboxPolicy('default', 'sb1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/policy',
    );
  });

  it('getGlobalPolicy calls correct path', async () => {
    await getGlobalPolicy();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/global-policy');
  });

  it('getDraftPolicy calls correct path', async () => {
    await getDraftPolicy('default', 'sb1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts',
    );
  });

  it('getDraftPolicy with status filter', async () => {
    await getDraftPolicy('default', 'sb1', 'pending');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts?status=pending',
    );
  });

  it('approveDraftChunk posts to correct path', async () => {
    await approveDraftChunk('default', 'sb1', 'chunk-123');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts/chunk-123/approve',
      {},
    );
  });

  it('rejectDraftChunk posts to correct path', async () => {
    await rejectDraftChunk('default', 'sb1', 'chunk-123', 'too broad');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts/chunk-123/reject',
      { reason: 'too broad' },
    );
  });
});

describe('settings API', () => {
  it('getGlobalSettings calls correct path', async () => {
    await getGlobalSettings();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/settings/global');
  });

  it('setGlobalSetting puts to correct path', async () => {
    await setGlobalSetting('key1', 'value1');
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/settings/global',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('deleteGlobalSetting calls correct path', async () => {
    await deleteGlobalSetting('key1');
    expect(mockDel).toHaveBeenCalledWith('/api/v1/settings/global?key=key1');
  });
});

describe('templates API', () => {
  it('listTemplates calls correct path', async () => {
    await listTemplates('default');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/templates',
    );
  });

  it('listTemplates passes label selector', async () => {
    await listTemplates('default', 'kind=harness');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/templates?labelSelector=kind%3Dharness',
    );
  });

  it('getTemplate calls correct path', async () => {
    await getTemplate('default', 'claude-harness');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/templates/claude-harness',
    );
  });

  it('createTemplate posts to correct path', async () => {
    const body = {
      name: 'claude-harness',
      spec: { workload: { image: 'base' } },
    };
    await createTemplate('default', body);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/templates',
      body,
    );
  });

  it('deleteTemplate deletes at correct path', async () => {
    await deleteTemplate('default', 'claude-harness');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/templates/claude-harness',
    );
  });

  it('createSandboxFromTemplate posts to correct path', async () => {
    const body = {
      templateName: 'claude-harness',
      policy: { version: 1 },
    };
    await createSandboxFromTemplate('default', body);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/from-template',
      body,
    );
  });
});
