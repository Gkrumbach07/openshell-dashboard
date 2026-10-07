import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { RESOURCE_POLL_MS } from '../constants';
import { del, get, post } from './client';
import { allWorkspacesKeys, sandboxKeys } from './queryKeys';
import { templateKeys } from './queryKeys';
import type {
  CreateSandboxFromTemplateRequest,
  CreateSandboxTemplateRequest,
  DeleteResult,
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
): Promise<DeleteResult> =>
  del<DeleteResult>(
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

// Polled: a template another workspace admin adds or deletes shows up without
// a reload.
export const useTemplates = (workspace: string, labelSelector?: string) =>
  useQuery({
    queryKey: templateKeys.list(workspace, labelSelector),
    queryFn: () => listTemplates(workspace, labelSelector),
    refetchInterval: RESOURCE_POLL_MS,
  });

export const useTemplate = (workspace: string, name: string) =>
  useQuery({
    queryKey: templateKeys.detail(workspace, name),
    queryFn: () => getTemplate(workspace, name),
  });

// A template is also a row of the list across workspaces, under every label
// selector that list was asked for.
export const useCreateTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxTemplateRequest) =>
      createTemplate(workspace, body),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: templateKeys.all(workspace),
        }),
        queryClient.invalidateQueries({
          queryKey: allWorkspacesKeys.allTemplates,
        }),
      ]),
  });
};

export const useDeleteTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteTemplate(workspace, name),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: templateKeys.all(workspace),
        }),
        queryClient.invalidateQueries({
          queryKey: allWorkspacesKeys.allTemplates,
        }),
      ]),
  });
};

export const useCreateSandboxFromTemplate = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSandboxFromTemplateRequest) =>
      createSandboxFromTemplate(workspace, body),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: sandboxKeys.scope(workspace),
        }),
        queryClient.invalidateQueries({
          queryKey: allWorkspacesKeys.allSandboxes,
        }),
      ]),
  });
};
