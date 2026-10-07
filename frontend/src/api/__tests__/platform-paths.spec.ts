import {
  listAllProviders,
  listAllSandboxes,
  listAllServices,
  listAllTemplates,
} from '../allWorkspaces';
import { allWorkspacesKeys, workspaceKeys } from '../queryKeys';
import { deleteService, getSandboxLogs } from '../sandboxes';
import { listWorkspaceServices, listWorkspaces } from '../workspaces';

jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

import { del, get } from '../client';

const mockGet = get as jest.Mock;
const mockDel = del as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue([]);
  mockDel.mockResolvedValue({});
});

// The lists across workspaces live at the top level, beside /workspaces: the
// workspace is not in the path because the answer spans all of them.
describe('all-workspaces API', () => {
  it('listAllSandboxes calls the top-level path', async () => {
    await listAllSandboxes();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/sandboxes');
  });

  it('listAllSandboxes passes a label selector, encoded', async () => {
    await listAllSandboxes('team=ml,tier=gpu');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/sandboxes?labelSelector=team%3Dml%2Ctier%3Dgpu',
    );
  });

  it('listAllProviders calls the top-level path', async () => {
    await listAllProviders();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/providers');
  });

  it('listAllTemplates calls the top-level path', async () => {
    await listAllTemplates();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/templates');
  });

  it('listAllTemplates passes a label selector, encoded', async () => {
    await listAllTemplates('lang=python');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/templates?labelSelector=lang%3Dpython',
    );
  });

  it('listAllServices calls the top-level path', async () => {
    await listAllServices();
    expect(mockGet).toHaveBeenCalledWith('/api/v1/services');
  });
});

describe('workspaces API', () => {
  it('listWorkspaces passes a label selector, encoded', async () => {
    await listWorkspaces('env=staging,owner=ml');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces?labelSelector=env%3Dstaging%2Cowner%3Dml',
    );
  });

  it('listWorkspaces sends no query for an empty selector', async () => {
    await listWorkspaces('');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workspaces');
  });

  it('listWorkspaceServices calls the workspace path', async () => {
    await listWorkspaceServices('team-a');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/workspaces/team-a/services');
  });
});

describe('service endpoints API', () => {
  it('deleteService names the service in the path', async () => {
    await deleteService('team-a', 'agent', 'web');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent/services/web',
    );
  });

  // The unnamed endpoint has no name to put there, and a trailing slash would
  // not match the route.
  it('deleteService stops at /services for the unnamed endpoint', async () => {
    await deleteService('team-a', 'agent', '');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent/services',
    );
  });
});

describe('sandbox logs API', () => {
  const now = 1_760_000_000_000;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const sinceMsOf = (callIndex: number): string | null =>
    new URL(
      mockGet.mock.calls[callIndex][0] as string,
      'http://bff.test',
    ).searchParams.get('sinceMs');

  // `openshell logs --since 5m`: the CLI sends the time five minutes before
  // the request, and so does this.
  it('turns a window into the point in time it starts at', async () => {
    await getSandboxLogs('team-a', 'agent', { sinceDurationMs: 300_000 });

    expect(sinceMsOf(0)).toBe(String(now - 300_000));
  });

  // The filters of a polled query do not change, so the window has to be
  // resolved on every request for it to move.
  it('moves the window forward on the next request', async () => {
    const filters = { sinceDurationMs: 300_000 };
    await getSandboxLogs('team-a', 'agent', filters);
    (Date.now as jest.Mock).mockReturnValue(now + 5_000);
    await getSandboxLogs('team-a', 'agent', filters);

    expect(sinceMsOf(0)).toBe(String(now - 300_000));
    expect(sinceMsOf(1)).toBe(String(now + 5_000 - 300_000));
  });

  it('keeps a fixed point in time as it is, and prefers it', async () => {
    await getSandboxLogs('team-a', 'agent', {
      sinceMs: 1_234,
      sinceDurationMs: 300_000,
    });

    expect(sinceMsOf(0)).toBe('1234');
  });

  it('sends no sinceMs without either', async () => {
    await getSandboxLogs('team-a', 'agent', { lines: 100 });

    expect(sinceMsOf(0)).toBeNull();
    expect(mockGet.mock.calls[0][0]).toBe(
      '/api/v1/workspaces/team-a/sandboxes/agent/logs?lines=100',
    );
  });
});

describe('query keys', () => {
  // useWorkspaces() without a selector has to keep the key every existing
  // reader and writer of the workspace list uses.
  it('keeps the plain workspace list key when there is no selector', () => {
    expect(workspaceKeys.list()).toEqual(workspaceKeys.all);
    expect(workspaceKeys.list('')).toEqual(workspaceKeys.all);
  });

  it('gives a filtered workspace list its own key under the list key', () => {
    const key = workspaceKeys.list('env=staging');

    expect(key).toEqual(['workspaces', { labelSelector: 'env=staging' }]);
    // Invalidating the list key reaches it.
    expect(key.slice(0, workspaceKeys.all.length)).toEqual(workspaceKeys.all);
    // A workspace named like the selector is a different key.
    expect(key).not.toEqual(workspaceKeys.detail('env=staging'));
  });

  it('keys each list across workspaces apart, by selector where it has one', () => {
    const keys = [
      allWorkspacesKeys.sandboxes(),
      allWorkspacesKeys.sandboxes('team=ml'),
      allWorkspacesKeys.providers,
      allWorkspacesKeys.templates(),
      allWorkspacesKeys.templates('team=ml'),
      allWorkspacesKeys.services,
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keys a workspace service list by workspace', () => {
    expect(workspaceKeys.services('team-a')).toEqual([
      'workspace-services',
      'team-a',
    ]);
    expect(workspaceKeys.services('team-a')).not.toEqual(
      workspaceKeys.services('team-b'),
    );
  });
});
