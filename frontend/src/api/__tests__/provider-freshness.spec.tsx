import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import {
  PLATFORM_PROFILE_SCOPE,
  useConfigureProviderRefresh,
  useCreateProvider,
  useDeleteProvider,
  useDeleteProviderProfile,
  useDeleteProviderRefresh,
  useImportProviderProfiles,
  useProvider,
  useProviderProfile,
  useProviderProfiles,
  useProviderRefreshStatus,
  useProviders,
  useRotateProviderCredential,
  useUpdateProvider,
  useUpdateProviderProfile,
} from '../providers';
import { RESOURCE_POLL_MS } from '../../constants';
import { apiFetch, del, get, post, put } from '../client';
import { allWorkspacesKeys, providerKeys, sandboxKeys } from '../queryKeys';

// The hooks are the real ones, on a real query client; only the HTTP calls
// under them are stubbed.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

const mockGet = get as jest.Mock;

// The app's own defaults: nothing is fetched again because the window got
// focus, so only an interval or an invalidation brings in a change.
const newClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  });

const wrapperFor = (client: QueryClient) => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const call of [get, post, put, del, apiFetch]) {
    (call as jest.Mock).mockResolvedValue([]);
  }
});

// A provider changed from the CLI, the TUI or another browser shows up
// without a reload: each query is fetched again at the pace of the other
// resource lists.
const PROVIDER_POLL_MS = RESOURCE_POLL_MS;

describe('provider queries are fetched again on an interval', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // Each hook returns its own type of result, which this table does not
  // read: it counts the requests the hook makes.
  it.each<[string, () => unknown, string]>([
    [
      'the provider list',
      () => useProviders('team-a'),
      '/api/v1/workspaces/team-a/providers',
    ],
    [
      'a provider',
      () => useProvider('team-a', 'gh'),
      '/api/v1/workspaces/team-a/providers/gh',
    ],
    [
      'the refresh status of a provider',
      () => useProviderRefreshStatus('team-a', 'gh'),
      '/api/v1/workspaces/team-a/providers/gh/refresh-status',
    ],
    [
      'the profiles of a workspace',
      () => useProviderProfiles('team-a'),
      '/api/v1/workspaces/team-a/provider-profiles',
    ],
    [
      'the profiles of the platform',
      () => useProviderProfiles(PLATFORM_PROFILE_SCOPE),
      '/api/v1/provider-profiles',
    ],
    [
      'a profile',
      () => useProviderProfile('team-a', 'github'),
      '/api/v1/workspaces/team-a/provider-profiles/github',
    ],
  ])('fetches %s again', async (_name, useQueryHook, path) => {
    const client = newClient();
    const { unmount } = renderHook(useQueryHook, {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenLastCalledWith(path);

    // Not sooner than the interval.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PROVIDER_POLL_MS - 1);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(PROVIDER_POLL_MS);
    });
    expect(mockGet).toHaveBeenCalledTimes(3);

    // And not at all once nothing shows it.
    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PROVIDER_POLL_MS * 3);
    });
    expect(mockGet).toHaveBeenCalledTimes(3);
  });
});

// Every query a page can be showing when a provider or a profile is written.
const KEYS = {
  list: providerKeys.all('team-a'),
  detail: providerKeys.detail('team-a', 'gh'),
  otherDetail: providerKeys.detail('team-a', 'other'),
  refresh: providerKeys.refresh('team-a', 'gh'),
  otherRefresh: providerKeys.refresh('team-a', 'other'),
  allWorkspaces: allWorkspacesKeys.providers,
  otherWorkspace: providerKeys.all('team-b'),
  profiles: providerKeys.profiles('team-a'),
  otherProfiles: providerKeys.profiles('team-b'),
  platformProfiles: providerKeys.profiles(PLATFORM_PROFILE_SCOPE),
  profile: providerKeys.profileDetail('team-a', 'github'),
  sandboxes: sandboxKeys.scope('team-a'),
} as const;

type KeyName = keyof typeof KEYS;

const seeded = (): QueryClient => {
  const client = newClient();
  for (const key of Object.values(KEYS)) {
    client.setQueryData(key, []);
  }
  return client;
};

// Which of the seeded queries a write left stale, and which it removed.
const staleAfter = (client: QueryClient) => {
  const stale: KeyName[] = [];
  const removed: KeyName[] = [];
  for (const [name, key] of Object.entries(KEYS) as [
    KeyName,
    readonly unknown[],
  ][]) {
    const state = client.getQueryState(key);
    if (!state) {
      removed.push(name);
    } else if (state.isInvalidated) {
      stale.push(name);
    }
  }
  return { stale: stale.sort(), removed: removed.sort() };
};

const PROVIDER_QUERIES: KeyName[] = [
  'allWorkspaces',
  'detail',
  'list',
  'otherDetail',
];
const PROFILE_QUERIES: KeyName[] = [
  'otherProfiles',
  'platformProfiles',
  'profile',
  'profiles',
];

// A mutation hook, as far as the table below uses one.
type Write = () => { mutateAsync: (variables: never) => Promise<unknown> };

// A write makes stale what it changed and leaves the rest alone. A query a
// page is showing is then fetched again at once; one nobody is showing is
// fetched when it is next shown.
describe('provider and profile writes make stale what they change', () => {
  it.each<[string, Write, unknown, KeyName[], KeyName[]]>([
    [
      'creating a provider',
      () => useCreateProvider('team-a'),
      { name: 'gh', type: 'github' },
      PROVIDER_QUERIES,
      [],
    ],
    [
      'updating a provider',
      () => useUpdateProvider('team-a'),
      { name: 'gh', config: { region: 'eu' } },
      // A new value or expiry is also a different refresh status.
      [...PROVIDER_QUERIES, 'refresh'],
      [],
    ],
    [
      'deleting a provider',
      () => useDeleteProvider('team-a'),
      'gh',
      PROVIDER_QUERIES,
      // Nothing is left to read of its refresh.
      ['refresh'],
    ],
    [
      'configuring a refresh',
      () => useConfigureProviderRefresh('team-a', 'gh'),
      { credentialKey: 'GH_TOKEN', strategy: 'static' },
      // The gateway mints the credential, so the provider holds it now.
      [...PROVIDER_QUERIES, 'refresh'],
      [],
    ],
    [
      'rotating a credential',
      () => useRotateProviderCredential('team-a', 'gh'),
      'GH_TOKEN',
      [...PROVIDER_QUERIES, 'refresh'],
      [],
    ],
    [
      'deleting a refresh',
      () => useDeleteProviderRefresh('team-a', 'gh'),
      'GH_TOKEN',
      [...PROVIDER_QUERIES, 'refresh'],
      [],
    ],
    [
      'importing profiles',
      () => useImportProviderProfiles('team-a'),
      [],
      // A platform profile is in every workspace's list.
      PROFILE_QUERIES,
      [],
    ],
    [
      'importing platform profiles',
      () => useImportProviderProfiles(PLATFORM_PROFILE_SCOPE),
      [],
      PROFILE_QUERIES,
      [],
    ],
    [
      'updating a profile',
      () => useUpdateProviderProfile('team-a'),
      { profileId: 'github', profile: {} },
      PROFILE_QUERIES,
      [],
    ],
    [
      'deleting a profile',
      () => useDeleteProviderProfile('team-a'),
      'github',
      PROFILE_QUERIES,
      [],
    ],
  ])('%s', async (_name, useMutationHook, variables, stale, removed) => {
    const client = seeded();
    const { result } = renderHook(useMutationHook, {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await (
        result.current.mutateAsync as (variables: unknown) => Promise<unknown>
      )(variables);
    });

    expect(staleAfter(client)).toEqual({
      stale: [...stale].sort(),
      removed: [...removed].sort(),
    });
  });
});
