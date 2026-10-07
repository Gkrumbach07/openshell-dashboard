import type { LogFilters } from '../types';

export const sandboxKeys = {
  all: ['sandboxes'] as const,
  // A workspace's list under one label selector. The selector sits in an
  // object so that the key can never be the detail key of a sandbox: a
  // selector is text the user types, and typed as a sandbox's name it would
  // otherwise read that sandbox's cache entry as the list. Both keys still
  // start with `scope`, which is what the mutations invalidate.
  list: (workspace: string, labelSelector = '') =>
    ['sandboxes', workspace, { labelSelector }] as const,
  detail: (workspace: string, name: string) =>
    ['sandboxes', workspace, name] as const,
  // Every list of a workspace and every sandbox in it.
  scope: (workspace: string) => ['sandboxes', workspace] as const,
  logs: (workspace: string, name: string, filters: LogFilters) =>
    ['sandbox-logs', workspace, name, filters] as const,
  providers: (workspace: string, name: string) =>
    ['sandbox-providers', workspace, name] as const,
  services: (workspace: string, sandbox: string) =>
    ['sandbox-services', workspace, sandbox] as const,
  settings: (workspace: string, name: string) =>
    ['sandbox-settings', workspace, name] as const,
  // Every sandbox's settings. A gateway-global setting or policy changes what
  // each of them reports, so writing one invalidates this.
  allSettings: ['sandbox-settings'] as const,
};

export const templateKeys = {
  // Every list of a workspace and every template in it.
  all: (workspace: string) => ['templates', workspace] as const,
  // The selector sits in an object for the reason it does in sandboxKeys.list.
  list: (workspace: string, labelSelector = '') =>
    ['templates', workspace, { labelSelector }] as const,
  detail: (workspace: string, name: string) =>
    ['templates', workspace, name] as const,
};

export const workspaceKeys = {
  all: ['workspaces'] as const,
  // The list filtered by a label selector. The selector sits in an object so
  // that it can never be mistaken for the name in a detail key, and the key
  // still starts with `all`, which is what the mutations invalidate.
  list: (labelSelector = '') =>
    labelSelector
      ? (['workspaces', { labelSelector }] as const)
      : (['workspaces'] as const),
  detail: (name: string) => ['workspaces', name] as const,
  members: (workspace: string) => ['members', workspace] as const,
  services: (workspace: string) => ['workspace-services', workspace] as const,
};

// Lists that span every workspace. The gateway answers them for platform
// admins only.
//
// Each list's key starts with the key of its kind (allSandboxes,
// allTemplates), and all of them with `all`, so a mutation invalidates one
// kind under every label selector, or everything at once.
export const allWorkspacesKeys = {
  all: ['all-workspaces'] as const,
  allSandboxes: ['all-workspaces', 'sandboxes'] as const,
  sandboxes: (labelSelector = '') =>
    ['all-workspaces', 'sandboxes', labelSelector] as const,
  providers: ['all-workspaces', 'providers'] as const,
  allTemplates: ['all-workspaces', 'templates'] as const,
  templates: (labelSelector = '') =>
    ['all-workspaces', 'templates', labelSelector] as const,
  services: ['all-workspaces', 'services'] as const,
};

export const providerKeys = {
  all: (workspace: string) => ['providers', workspace] as const,
  detail: (workspace: string, name: string) =>
    ['providers', workspace, name] as const,
  // Every scope's profile lists and profiles: the prefix of the two below.
  allProfiles: ['provider-profiles'] as const,
  profiles: (workspace: string) => ['provider-profiles', workspace] as const,
  profileDetail: (workspace: string, profileId: string) =>
    ['provider-profiles', workspace, profileId] as const,
  refresh: (workspace: string, name: string) =>
    ['provider-refresh', workspace, name] as const,
};

export const policyKeys = {
  // Every sandbox's policy view and effective policy. Setting or deleting the
  // gateway-global policy changes all of them.
  allSandboxes: ['sandbox-policy'] as const,
  sandbox: (workspace: string, name: string) =>
    ['sandbox-policy', workspace, name] as const,
  // Prefixed by `sandbox`, so invalidating a sandbox's policy covers both.
  effective: (workspace: string, name: string) =>
    ['sandbox-policy', workspace, name, 'effective'] as const,
  global: ['global-policy'] as const,
  globalRevision: (version: number) =>
    ['global-policy', 'revisions', version] as const,
  // The key with a status filter is prefixed by the one without, so
  // invalidating a sandbox's drafts covers every filter.
  drafts: (workspace: string, name: string, status?: string) =>
    status
      ? (['drafts', workspace, name, status] as const)
      : (['drafts', workspace, name] as const),
  draftHistory: (workspace: string, name: string) =>
    ['draft-history', workspace, name] as const,
  draftSummary: ['draft-summary'] as const,
  // One workspace's summary. Prefixed by `draftSummary`, so invalidating that
  // covers every workspace's.
  workspaceDraftSummary: (workspace: string) =>
    ['draft-summary', workspace] as const,
};

export const gatewayKeys = {
  info: ['gateway'] as const,
  compatibility: ['gateway', 'compatibility'] as const,
};

export const authKeys = {
  config: ['auth', 'config'] as const,
  whoami: ['auth', 'whoami'] as const,
};

export const settingsKeys = {
  global: ['global-settings'] as const,
};
