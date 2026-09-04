import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, post } from './client';
import { sandboxKeys } from './queryKeys';
import { templateKeys } from './queryKeys';
import type {
  CreateSandboxFromTemplateRequest,
  CreateSandboxTemplateRequest,
  Sandbox,
  SandboxTemplate,
} from '../types';

export const listTemplates = (
  workspace: string,
  labelSelector?: string,
): Promise<SandboxTemplate[]> =>
  get<SandboxTemplate[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/templates${
      labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
    }`,
  );

export const getTemplate = (
  workspace: string,
  name: string,
): Promise<SandboxTemplate> =>
  get<SandboxTemplate>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/templates/${encodeURIComponent(name)}`,
  );

export const createTemplate = (
  workspace: string,
  body: CreateSandboxTemplateRequest,
): Promise<SandboxTemplate> =>
  post<SandboxTemplate>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/templates`,
    body,
  );

export const deleteTemplate = (
  workspace: string,
  name: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/templates/${encodeURIComponent(name)}`,
  );

export const createSandboxFromTemplate = (
  workspace: string,
  body: CreateSandboxFromTemplateRequest,
): Promise<Sandbox> =>
  post<Sandbox>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/from-template`,
    body,
  );

export const useTemplates = (workspace: string, labelSelector?: string) =>
  useQuery({
    queryKey: templateKeys.list(workspace, labelSelector),
    queryFn: () => listTemplates(workspace, labelSelector),
  });

export const useTemplate = (workspace: string, name: string) =>
  useQuery({
    queryKey: templateKeys.detail(workspace, name),
    queryFn: () => getTemplate(workspace, name),
  });

export const useCreateTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxTemplateRequest) =>
      createTemplate(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: templateKeys.all(workspace) }),
  });
};

export const useDeleteTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteTemplate(workspace, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: templateKeys.all(workspace) }),
  });
};

export const useCreateSandboxFromTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxFromTemplateRequest) =>
      createSandboxFromTemplate(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.scope(workspace) }),
  });
};
