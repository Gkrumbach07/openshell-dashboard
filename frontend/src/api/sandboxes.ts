import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getToken } from '../app/authStore';
import { del, get, post } from './client';
import type {
  CreateSandboxRequest,
  ExposeServiceRequest,
  Provider,
  Sandbox,
  SandboxLogs,
  ServiceEndpoint,
} from '../types';

// Live status is polling-based (no WebSockets): sandbox queries refetch on an
// interval so phase transitions show up without a manual refresh.
const POLL_INTERVAL_MS = 5_000;

export const listSandboxes = (workspace: string, labelSelector?: string): Promise<Sandbox[]> =>
  get<Sandbox[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes${
      labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
    }`,
  );

export const getSandbox = (workspace: string, name: string): Promise<Sandbox> =>
  get<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}`,
  );

export const createSandbox = (workspace: string, body: CreateSandboxRequest): Promise<Sandbox> =>
  post<Sandbox>(`/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes`, body);

export const deleteSandbox = (workspace: string, name: string): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}`,
  );

export const useSandboxes = (workspace: string, labelSelector?: string) =>
  useQuery({
    queryKey: ['sandboxes', workspace, labelSelector ?? ''],
    queryFn: () => listSandboxes(workspace, labelSelector),
    refetchInterval: POLL_INTERVAL_MS,
  });

export const useSandbox = (workspace: string, name: string) =>
  useQuery({
    queryKey: ['sandboxes', workspace, name],
    queryFn: () => getSandbox(workspace, name),
    refetchInterval: POLL_INTERVAL_MS,
  });

export const useCreateSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxRequest) => createSandbox(workspace, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes', workspace] }),
  });
};

export type LogFilters = {
  lines?: number;
  sinceMs?: number;
  // "gateway" and/or "sandbox".
  sources?: string[];
  level?: string;
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
    queryKey: ['sandbox-logs', workspace, name, filters],
    queryFn: () => getSandboxLogs(workspace, name, filters),
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  });

export const listAttachedProviders = (workspace: string, name: string): Promise<Provider[]> =>
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
    queryKey: ['sandbox-providers', workspace, name],
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
      queryClient.invalidateQueries({ queryKey: ['sandbox-providers', workspace, name] });
      queryClient.invalidateQueries({ queryKey: ['sandboxes', workspace, name] });
    },
  });
};

export const useDetachProvider = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => detachProvider(workspace, name, provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox-providers', workspace, name] });
      queryClient.invalidateQueries({ queryKey: ['sandboxes', workspace, name] });
    },
  });
};

export const useDeleteSandbox = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSandbox(workspace, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes', workspace] }),
  });
};

// --- Service endpoints ---

export const listServices = (workspace: string, sandbox: string): Promise<ServiceEndpoint[]> =>
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
    queryKey: ['sandbox-services', workspace, sandbox],
    queryFn: () => listServices(workspace, sandbox),
    refetchInterval: POLL_INTERVAL_MS,
  });

export const useExposeService = (workspace: string, sandbox: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ExposeServiceRequest) => exposeService(workspace, sandbox, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['sandbox-services', workspace, sandbox] }),
  });
};

export const useDeleteService = (workspace: string, sandbox: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (service: string) => deleteService(workspace, sandbox, service),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['sandbox-services', workspace, sandbox] }),
  });
};

// --- File upload/download ---

export type UploadResult = {
  exitCode: number;
  path: string;
  size: number;
  stdout: string;
  stderr: string;
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
  const token = getToken();
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/files${params}`,
    {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || `Upload failed (${response.status})`);
  }
  return response.json() as Promise<UploadResult>;
};

export const downloadFile = async (
  workspace: string,
  name: string,
  path: string,
): Promise<void> => {
  const token = getToken();
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message || `Download failed (${response.status})`,
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
