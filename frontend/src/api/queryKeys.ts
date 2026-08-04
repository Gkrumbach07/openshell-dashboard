import type { LogFilters } from '../types';

export const sandboxKeys = {
  all: ['sandboxes'] as const,
  list: (workspace: string, labelSelector = '') =>
    ['sandboxes', workspace, labelSelector] as const,
  detail: (workspace: string, name: string) =>
    ['sandboxes', workspace, name] as const,
  scope: (workspace: string) => ['sandboxes', workspace] as const,
  logs: (workspace: string, name: string, filters: LogFilters) =>
    ['sandbox-logs', workspace, name, filters] as const,
  providers: (workspace: string, name: string) =>
    ['sandbox-providers', workspace, name] as const,
  services: (workspace: string, sandbox: string) =>
    ['sandbox-services', workspace, sandbox] as const,
};

export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (name: string) => ['workspaces', name] as const,
  members: (workspace: string) => ['members', workspace] as const,
};

export const providerKeys = {
  all: (workspace: string) => ['providers', workspace] as const,
  detail: (workspace: string, name: string) =>
    ['providers', workspace, name] as const,
  profiles: (workspace: string) => ['provider-profiles', workspace] as const,
  profileDetail: (workspace: string, profileId: string) =>
    ['provider-profiles', workspace, profileId] as const,
  refresh: (workspace: string, name: string) =>
    ['provider-refresh', workspace, name] as const,
};

export const policyKeys = {
  sandbox: (workspace: string, name: string) =>
    ['sandbox-policy', workspace, name] as const,
  global: ['global-policy'] as const,
  drafts: (workspace: string, name: string) =>
    ['drafts', workspace, name] as const,
  draftHistory: (workspace: string, name: string) =>
    ['draft-history', workspace, name] as const,
  draftSummary: ['draft-summary'] as const,
};

export const gatewayKeys = {
  info: ['gateway'] as const,
};

export const authKeys = {
  config: ['auth', 'config'] as const,
  userInfo: ['auth', 'userinfo'] as const,
  whoami: ['auth', 'whoami'] as const,
};

export const inferenceKeys = {
  route: (workspace: string, route: string) =>
    ['inference', workspace, route] as const,
  scope: (workspace: string) => ['inference', workspace] as const,
};

export const settingsKeys = {
  global: ['global-settings'] as const,
};
