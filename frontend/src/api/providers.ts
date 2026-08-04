import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { STALE_5_MIN } from '../constants';
import { apiFetch, del, get, post, put } from './client';
import { providerKeys } from './queryKeys';
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

// Provider type profiles: the valid Provider.type slugs and their credential
// schemas. Drives the Add Provider form.
export const listProviderProfiles = (
  workspace: string,
): Promise<ProviderProfile[]> =>
  get<ProviderProfile[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles`,
  );

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
  });

export const useProviders = (workspace: string) =>
  useQuery({
    queryKey: providerKeys.all(workspace),
    queryFn: () => listProviders(workspace),
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
  });

export const useProviderProfiles = (workspace: string) =>
  useQuery({
    queryKey: providerKeys.profiles(workspace),
    queryFn: () => listProviderProfiles(workspace),
    staleTime: STALE_5_MIN,
  });

export const useCreateProvider = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProviderRequest) =>
      createProvider(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: providerKeys.all(workspace) }),
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: providerKeys.all(workspace) }),
  });
};

export const useDeleteProvider = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteProvider(workspace, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: providerKeys.all(workspace) }),
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

export const useConfigureProviderRefresh = (
  workspace: string,
  name: string,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigureProviderRefreshRequest) =>
      configureProviderRefresh(workspace, name, body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: providerKeys.refresh(workspace, name),
      }),
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
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: providerKeys.refresh(workspace, name),
      }),
  });
};

export const useDeleteProviderRefresh = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialKey: string) =>
      deleteProviderRefresh(workspace, name, credentialKey),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: providerKeys.refresh(workspace, name),
      }),
  });
};

// --- Provider profile CRUD ---

export const getProviderProfile = (
  workspace: string,
  profileId: string,
): Promise<ProviderProfile> =>
  get<ProviderProfile>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles/${encodeURIComponent(profileId)}`,
  );

export const importProviderProfiles = (
  workspace: string,
  profiles: ImportProfileRequest[],
): Promise<ImportProfilesResponse> =>
  post<ImportProfilesResponse>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles`,
    { profiles },
  );

export const updateProviderProfile = (
  workspace: string,
  profileId: string,
  profile: ImportProfileRequest,
  expectedResourceVersion?: number,
): Promise<UpdateProfileResponse> =>
  put<UpdateProfileResponse>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles/${encodeURIComponent(profileId)}`,
    { profile, expectedResourceVersion },
  );

export const deleteProviderProfile = (
  workspace: string,
  profileId: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles/${encodeURIComponent(profileId)}`,
  );

export const lintProviderProfiles = (
  workspace: string,
  profiles: ImportProfileRequest[],
): Promise<LintProfilesResponse> =>
  post<LintProfilesResponse>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/provider-profiles/lint`,
    { profiles },
  );

export const useProviderProfile = (workspace: string, profileId: string) =>
  useQuery({
    queryKey: ['provider-profiles', workspace, profileId],
    queryFn: () => getProviderProfile(workspace, profileId),
    enabled: !!profileId,
  });

export const useImportProviderProfiles = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profiles: ImportProfileRequest[]) =>
      importProviderProfiles(workspace, profiles),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['provider-profiles', workspace],
      }),
  });
};

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
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['provider-profiles', workspace],
      }),
  });
};

export const useDeleteProviderProfile = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      deleteProviderProfile(workspace, profileId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['provider-profiles', workspace],
      }),
  });
};
