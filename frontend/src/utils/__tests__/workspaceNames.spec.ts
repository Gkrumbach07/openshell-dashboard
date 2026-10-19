import {
  sandboxPath,
  scopedName,
  workspaceOf,
  workspacePath,
} from '../workspaceNames';

describe('workspace names', () => {
  it('reads the workspace a resource is in, or none', () => {
    expect(workspaceOf({ metadata: { workspace: 'team-a' } })).toBe('team-a');
    expect(workspaceOf({ metadata: {} })).toBe('');
  });

  // The same name in two workspaces is two resources.
  it('scopes a name by its workspace', () => {
    expect(
      scopedName({ metadata: { workspace: 'team-a', name: 'agent' } }),
    ).toBe('team-a/agent');
    expect(
      scopedName({ metadata: { workspace: 'team-b', name: 'agent' } }),
    ).not.toBe('team-a/agent');
  });

  it('encodes each name as one path segment', () => {
    expect(workspacePath('team-a')).toBe('/workspaces/team-a');
    expect(sandboxPath('team-a', 'agent')).toBe(
      '/workspaces/team-a/sandboxes/agent',
    );
    expect(sandboxPath('a/b', 'c?d')).toBe('/workspaces/a%2Fb/sandboxes/c%3Fd');
  });
});
