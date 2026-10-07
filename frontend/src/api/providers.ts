import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { RESOURCE_POLL_MS, STALE_5_MIN } from '../constants';
import { apiFetch, del, get, post, put } from './client';
import { allWorkspacesKeys, providerKeys } from './queryKeys';
import type {
  ConfigureProviderRefreshRequest,
  CreateProviderRequest,
  CredentialRefreshStatus,
  ImportProfileRequest,
  ImportProfilesResponse,
  LintProfilesResponse,
  Provider,
  ProviderProfile,
  UpdateProfileResponse,
} from '../types';

// The provider and profile queries are fetched again while a page shows
// them, at the pace of the other resource lists. Nothing else brings in what
// was changed from the CLI, the TUI or another browser: the app does not
// refetch when its window gets focus.
const PROVIDER_POLL_MS = RESOURCE_POLL_MS;

export const listProviders = (workspace: string): Promise<Provider[]> =>
  get<Provider[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers`,
  );

export const getProvider = (
  workspace: string,
  name: string,
): Promise<Provider> =>
  get<Provider>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}`,
  );

export const createProvider = (
  workspace: string,
  body: CreateProviderRequest,
): Promise<Provider> =>
  post<Provider>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers`,
    body,
  );

export const updateProvider = (
  workspace: string,
  name: string,
  body: {
    credentials?: Record<string, string>;
    credentialExpiresAtMs?: Record<string, number>;
    config?: Record<string, string>;
  },
): Promise<Provider> =>
  put<Provider>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}`,
    body,
  );

export const deleteProvider = (
  workspace: string,
  name: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}`,
  );

// The scope of the platform's own provider profiles, which belong to no
// workspace and which every workspace sees: the CLI's `--global`. It goes
// where a profile function takes a workspace. It is not a workspace name and
// cannot be mistaken for one, which is a DNS label.
export const PLATFORM_PROFILE_SCOPE = '@platform';

// Where a scope's profiles are served: under the workspace, or at the top
// level for the platform's.
const profilesPath = (scope: string): string =>
  scope === PLATFORM_PROFILE_SCOPE
    ? '/api/v1/provider-profiles'
    : `/api/v1/workspaces/${encodeURIComponent(scope)}/provider-profiles`;

// Provider type profiles: the valid Provider.type slugs and their credential
// schemas. Drives the Add Provider form. A workspace's list holds its own
// profiles and the platform's, each naming its scope.
export const listProviderProfiles = (
  workspace: string,
): Promise<ProviderProfile[]> =>
  get<ProviderProfile[]>(profilesPath(workspace));

export const getProviderRefreshStatus = (
  workspace: string,
  name: string,
): Promise<CredentialRefreshStatus[]> =>
  get<CredentialRefreshStatus[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}/refresh-status`,
  );

export const useProviderRefreshStatus = (workspace: string, name: string) =>
  useQuery({
    queryKey: providerKeys.refresh(workspace, name),
    queryFn: () => getProviderRefreshStatus(workspace, name),
    retry: false,
    refetchInterval: PROVIDER_POLL_MS,
  });

export const useProviders = (workspace: string) =>
  useQuery({
    queryKey: providerKeys.all(workspace),
    queryFn: () => listProviders(workspace),
    refetchInterval: PROVIDER_POLL_MS,
  });

export const useProviderExpiry = (
  workspace: string,
): Record<string, number> => {
  const providers = useProviders(workspace);
  return useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of providers.data ?? []) {
      const values = Object.values(p.credentialExpiresAtMs ?? {});
      if (values.length === 0) continue;
      const earliest = Math.min(...values);
      if (earliest > 0) map[p.metadata.name] = earliest;
    }
    return map;
  }, [providers.data]);
};

export const useProvider = (workspace: string, name: string) =>
  useQuery({
    queryKey: providerKeys.detail(workspace, name),
    queryFn: () => getProvider(workspace, name),
    refetchInterval: PROVIDER_POLL_MS,
  });

export const useProviderProfiles = (workspace: string) =>
  useQuery({
    queryKey: providerKeys.profiles(workspace),
    queryFn: () => listProviderProfiles(workspace),
    staleTime: STALE_5_MIN,
    refetchInterval: PROVIDER_POLL_MS,
  });

// What a write to a workspace's providers makes stale: the workspace's list
// and every provider read from it, whose keys the list's key is the prefix
// of, and the list that spans all workspaces.
const invalidateProviders = (
  queryClient: ReturnType<typeof useQueryClient>,
  workspace: string,
) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: providerKeys.all(workspace) }),
    queryClient.invalidateQueries({ queryKey: allWorkspacesKeys.providers }),
  ]);

// How long a request that carries credential values is kept once nothing
// reads it any more: not at all.
//
// React Query holds on to a mutation, its variables included, for five
// minutes after the last component that used it has unmounted or reset it.
// The variables of these requests are credential values and refresh material.
// An embedding host owns the query client and may inspect or persist what is
// in it, so nothing secret is left there once the dialog that sent it has
// closed. While the dialog is open the mutation is still observed, and stays:
// the error of a request that failed is read from it.
const SECRET_REQUEST_GC_MS = 0;

export const useCreateProvider = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProviderRequest) =>
      createProvider(workspace, body),
    onSuccess: () => invalidateProviders(queryClient, workspace),
    gcTime: SECRET_REQUEST_GC_MS,
  });
};

export const useUpdateProvider = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      ...body
    }: {
      name: string;
      credentials?: Record<string, string>;
      credentialExpiresAtMs?: Record<string, number>;
      config?: Record<string, string>;
    }) => updateProvider(workspace, name, body),
    // A credential given a new value or a new expiry is also a different
    // refresh status.
    onSuccess: (_provider, { name }) =>
      Promise.all([
        invalidateProviders(queryClient, workspace),
        queryClient.invalidateQueries({
          queryKey: providerKeys.refresh(workspace, name),
        }),
      ]),
    gcTime: SECRET_REQUEST_GC_MS,
  });
};

export const useDeleteProvider = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteProvider(workspace, name),
    onSuccess: (_result, name) => {
      // Nothing is left to read of the refresh of a provider that is gone.
      queryClient.removeQueries({
        queryKey: providerKeys.refresh(workspace, name),
      });
      return invalidateProviders(queryClient, workspace);
    },
  });
};

export const configureProviderRefresh = (
  workspace: string,
  name: string,
  body: ConfigureProviderRefreshRequest,
): Promise<CredentialRefreshStatus> =>
  post<CredentialRefreshStatus>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}/refresh`,
    body,
  );

export const rotateProviderCredential = (
  workspace: string,
  name: string,
  credentialKey: string,
): Promise<CredentialRefreshStatus> =>
  post<CredentialRefreshStatus>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}/refresh/rotate`,
    { credentialKey },
  );

export const deleteProviderRefresh = (
  workspace: string,
  name: string,
  credentialKey: string,
): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/providers/${encodeURIComponent(name)}/refresh?credentialKey=${encodeURIComponent(credentialKey)}`,
    { method: 'DELETE' },
  );

// What configuring, running or removing a refresh makes stale: the refresh
// status, and the provider itself. A refresh the gateway performs mints the
// credential, so the keys a provider holds and their expiry times change with
// it; a provider created with runtime credentials holds none until then.
const invalidateProviderRefresh = (
  queryClient: ReturnType<typeof useQueryClient>,
  workspace: string,
  name: string,
) =>
  Promise.all([
    queryClient.invalidateQueries({
      queryKey: providerKeys.refresh(workspace, name),
    }),
    invalidateProviders(queryClient, workspace),
  ]);

export const useConfigureProviderRefresh = (
  workspace: string,
  name: string,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigureProviderRefreshRequest) =>
      configureProviderRefresh(workspace, name, body),
    onSuccess: () => invalidateProviderRefresh(queryClient, workspace, name),
    gcTime: SECRET_REQUEST_GC_MS,
  });
};

export const useRotateProviderCredential = (
  workspace: string,
  name: string,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialKey: string) =>
      rotateProviderCredential(workspace, name, credentialKey),
    onSuccess: () => invalidateProviderRefresh(queryClient, workspace, name),
  });
};

export const useDeleteProviderRefresh = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialKey: string) =>
      deleteProviderRefresh(workspace, name, credentialKey),
    onSuccess: () => invalidateProviderRefresh(queryClient, workspace, name),
  });
};

// --- Provider profile CRUD ---
//
// Each of these takes the workspace whose profiles it addresses, or
// PLATFORM_PROFILE_SCOPE for the platform's. The gateway answers the platform
// scope for platform admins only.

export const getProviderProfile = (
  workspace: string,
  profileId: string,
): Promise<ProviderProfile> =>
  get<ProviderProfile>(
    `${profilesPath(workspace)}/${encodeURIComponent(profileId)}`,
  );

export const importProviderProfiles = (
  workspace: string,
  profiles: ImportProfileRequest[],
): Promise<ImportProfilesResponse> =>
  post<ImportProfilesResponse>(profilesPath(workspace), { profiles });

// Replaces the stored profile with the one given: the gateway does not merge,
// so `profile` is the whole profile as it should be afterwards.
export const updateProviderProfile = (
  workspace: string,
  profileId: string,
  profile: ImportProfileRequest,
  expectedResourceVersion?: number,
): Promise<UpdateProfileResponse> =>
  put<UpdateProfileResponse>(
    `${profilesPath(workspace)}/${encodeURIComponent(profileId)}`,
    { profile, expectedResourceVersion },
  );

export const deleteProviderProfile = (
  workspace: string,
  profileId: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `${profilesPath(workspace)}/${encodeURIComponent(profileId)}`,
  );

export const lintProviderProfiles = (
  workspace: string,
  profiles: ImportProfileRequest[],
): Promise<LintProfilesResponse> =>
  post<LintProfilesResponse>(`${profilesPath(workspace)}/lint`, { profiles });

export const useProviderProfile = (workspace: string, profileId: string) =>
  useQuery({
    queryKey: providerKeys.profileDetail(workspace, profileId),
    queryFn: () => getProviderProfile(workspace, profileId),
    enabled: !!profileId,
    refetchInterval: PROVIDER_POLL_MS,
  });

// A profile written in one scope can change what another lists: a platform
// profile is in every workspace's list. So a write refreshes every profile
// list, not only its own scope's.
const invalidateProfiles = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: providerKeys.allProfiles });

export const useImportProviderProfiles = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profiles: ImportProfileRequest[]) =>
      importProviderProfiles(workspace, profiles),
    onSuccess: () => invalidateProfiles(queryClient),
  });
};

export const useLintProviderProfiles = (workspace: string) =>
  useMutation({
    mutationFn: (profiles: ImportProfileRequest[]) =>
      lintProviderProfiles(workspace, profiles),
  });

export const useUpdateProviderProfile = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      profileId,
      profile,
      expectedResourceVersion,
    }: {
      profileId: string;
      profile: ImportProfileRequest;
      expectedResourceVersion?: number;
    }) =>
      updateProviderProfile(
        workspace,
        profileId,
        profile,
        expectedResourceVersion,
      ),
    onSuccess: () => invalidateProfiles(queryClient),
  });
};

export const useDeleteProviderProfile = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      deleteProviderProfile(workspace, profileId),
    onSuccess: () => invalidateProfiles(queryClient),
  });
};
