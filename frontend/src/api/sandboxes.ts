import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SANDBOX_POLL_MS } from '../constants';
import { del, get, post } from './client';
import { sandboxKeys } from './queryKeys';
import type {
  CreateSandboxRequest,
  ExposeServiceRequest,
  LogFilters,
  Provider,
  Sandbox,
  SandboxLogs,
  ServiceEndpoint,
} from '../types';

export const listSandboxes = (
  workspace: string,
  labelSelector?: string,
): Promise<Sandbox[]> =>
  get<Sandbox[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes${
      labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
    }`,
  );

export const getSandbox = (workspace: string, name: string): Promise<Sandbox> =>
  get<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}`,
  );

export const createSandbox = (
  workspace: string,
  body: CreateSandboxRequest,
): Promise<Sandbox> =>
  post<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes`,
    body,
  );

export const deleteSandbox = (
  workspace: string,
  name: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}`,
  );

export const stopSandbox = (
  workspace: string,
  name: string,
): Promise<Sandbox> =>
  post<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/stop`,
  );

export const startSandbox = (
  workspace: string,
  name: string,
): Promise<Sandbox> =>
  post<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/start`,
  );

export const useSandboxes = (workspace: string, labelSelector?: string) =>
  useQuery({
    queryKey: sandboxKeys.list(workspace, labelSelector),
    queryFn: () => listSandboxes(workspace, labelSelector),
    refetchInterval: SANDBOX_POLL_MS,
  });

export const useSandbox = (workspace: string, name: string) =>
  useQuery({
    queryKey: sandboxKeys.detail(workspace, name),
    queryFn: () => getSandbox(workspace, name),
    refetchInterval: SANDBOX_POLL_MS,
  });

export const useCreateSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxRequest) => createSandbox(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.scope(workspace) }),
  });
};

// One-shot log fetch; the UI polls this (no streaming through the BFF).
export const getSandboxLogs = (
  workspace: string,
  name: string,
  filters: LogFilters = {},
): Promise<SandboxLogs> => {
  const params = new URLSearchParams();
  if (filters.lines) {
    params.set('lines', String(filters.lines));
  }
  if (filters.sinceMs) {
    params.set('sinceMs', String(filters.sinceMs));
  }
  for (const source of filters.sources ?? []) {
    params.append('source', source);
  }
  if (filters.level) {
    params.set('level', filters.level);
  }
  const query = params.toString();
  return get<SandboxLogs>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/logs${query ? `?${query}` : ''}`,
  );
};

export const useSandboxLogs = (
  workspace: string,
  name: string,
  filters: LogFilters,
  autoRefresh: boolean,
) =>
  useQuery({
    queryKey: sandboxKeys.logs(workspace, name, filters),
    queryFn: () => getSandboxLogs(workspace, name, filters),
    refetchInterval: autoRefresh ? SANDBOX_POLL_MS : false,
  });

export const listAttachedProviders = (
  workspace: string,
  name: string,
): Promise<Provider[]> =>
  get<Provider[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/providers`,
  );

export const attachProvider = (
  workspace: string,
  name: string,
  provider: string,
  expectedResourceVersion?: number,
): Promise<{ attached: boolean }> =>
  post<{ attached: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/providers/${encodeURIComponent(provider)}`,
    { expectedResourceVersion },
  );

export const detachProvider = (
  workspace: string,
  name: string,
  provider: string,
): Promise<{ detached: boolean }> =>
  del<{ detached: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/providers/${encodeURIComponent(provider)}`,
  );

export const useAttachedProviders = (workspace: string, name: string) =>
  useQuery({
    queryKey: sandboxKeys.providers(workspace, name),
    queryFn: () => listAttachedProviders(workspace, name),
  });

export const useAttachProvider = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      expectedResourceVersion,
    }: {
      provider: string;
      expectedResourceVersion?: number;
    }) => attachProvider(workspace, name, provider, expectedResourceVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.providers(workspace, name),
      });
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.detail(workspace, name),
      });
    },
  });
};

export const useDetachProvider = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => detachProvider(workspace, name, provider),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.providers(workspace, name),
      });
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.detail(workspace, name),
      });
    },
  });
};

export const useDeleteSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSandbox(workspace, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.scope(workspace) }),
  });
};

export const useStopSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => stopSandbox(workspace, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.scope(workspace) }),
  });
};

export const useStartSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => startSandbox(workspace, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.scope(workspace) }),
  });
};

// --- Service endpoints ---

export const listServices = (
  workspace: string,
  sandbox: string,
): Promise<ServiceEndpoint[]> =>
  get<ServiceEndpoint[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandbox)}/services`,
  );

export const exposeService = (
  workspace: string,
  sandbox: string,
  body: ExposeServiceRequest,
): Promise<ServiceEndpoint> =>
  post<ServiceEndpoint>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandbox)}/services`,
    body,
  );

export const deleteService = (
  workspace: string,
  sandbox: string,
  service: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(sandbox)}/services/${encodeURIComponent(service)}`,
  );

export const useServices = (workspace: string, sandbox: string) =>
  useQuery({
    queryKey: sandboxKeys.services(workspace, sandbox),
    queryFn: () => listServices(workspace, sandbox),
    refetchInterval: SANDBOX_POLL_MS,
  });

export const useExposeService = (workspace: string, sandbox: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ExposeServiceRequest) =>
      exposeService(workspace, sandbox, body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.services(workspace, sandbox),
      }),
  });
};

export const useDeleteService = (workspace: string, sandbox: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (service: string) => deleteService(workspace, sandbox, service),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.services(workspace, sandbox),
      }),
  });
};

// --- File upload/download ---

export type UploadResult = {
  exitCode: number;
  path: string;
  size: number;
  stdout: string;
  success: boolean;
};

export const uploadFile = async (
  workspace: string,
  name: string,
  file: File,
  dest?: string,
): Promise<UploadResult> => {
  const formData = new FormData();
  formData.append('file', file);
  const params = dest ? `?dest=${encodeURIComponent(dest)}` : '';
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/files${params}`,
    {
      method: 'POST',
      body: formData,
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ||
        `Upload failed (${response.status})`,
    );
  }
  return response.json() as Promise<UploadResult>;
};

export const downloadFile = async (
  workspace: string,
  name: string,
  path: string,
): Promise<void> => {
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ||
        `Download failed (${response.status})`,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop() || 'download';
  a.click();
  URL.revokeObjectURL(url);
};

export const useUploadFile = (workspace: string, name: string) =>
  useMutation({
    mutationFn: ({ file, dest }: { file: File; dest?: string }) =>
      uploadFile(workspace, name, file, dest),
  });
