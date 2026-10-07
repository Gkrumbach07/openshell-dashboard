import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { RESOURCE_POLL_MS } from '../constants';
import { del, get, post } from './client';
import { allWorkspacesKeys, workspaceKeys } from './queryKeys';
import type {
  AddMemberRequest,
  CreateWorkspaceRequest,
  ServiceEndpoint,
  Workspace,
  WorkspaceMember,
} from '../types';

// labelSelector is the gateway's own form, key1=value1,key2=value2, which is
// what `openshell workspace list --label-selector` takes. The gateway refuses
// anything else with a 400.
export const listWorkspaces = (labelSelector?: string): Promise<Workspace[]> =>
  get<Workspace[]>(
    `/api/v1/workspaces${
      labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
    }`,
  );

export const getWorkspace = (name: string): Promise<Workspace> =>
  get<Workspace>(`/api/v1/workspaces/${encodeURIComponent(name)}`);

export const createWorkspace = (
  body: CreateWorkspaceRequest,
): Promise<Workspace> => post<Workspace>('/api/v1/workspaces', body);

export const deleteWorkspace = (name: string): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(`/api/v1/workspaces/${encodeURIComponent(name)}`);

export const listMembers = (workspace: string): Promise<WorkspaceMember[]> =>
  get<WorkspaceMember[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/members`,
  );

export const addMember = (
  workspace: string,
  body: AddMemberRequest,
): Promise<WorkspaceMember> =>
  post<WorkspaceMember>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/members`,
    body,
  );

export const removeMember = (
  workspace: string,
  subject: string,
): Promise<{ removed: boolean }> =>
  del<{ removed: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/members/${encodeURIComponent(subject)}`,
  );

// Every service endpoint exposed by the sandboxes of one workspace: what
// `openshell service list` prints when no sandbox is named.
export const listWorkspaceServices = (
  workspace: string,
): Promise<ServiceEndpoint[]> =>
  get<ServiceEndpoint[]>(
    `/api/v1/workspaces/${encodeURIComponent(workspace)}/services`,
  );

// While a new selector is being fetched the rows of the last one stay on
// screen, so the filter box the user is typing in is not replaced by a
// spinner.
//
// Polled: a workspace somebody else creates or deletes, and the phase of one
// that is being deleted, show up without a reload.
export const useWorkspaces = (labelSelector?: string) =>
  useQuery({
    queryKey: workspaceKeys.list(labelSelector),
    queryFn: () => listWorkspaces(labelSelector),
    placeholderData: keepPreviousData,
    refetchInterval: RESOURCE_POLL_MS,
  });

type UseWorkspaceServicesOptions = {
  // False where the services feature is switched off, so nothing is fetched.
  enabled?: boolean;
};

// Polled at the pace of the other lists somebody has to change: an endpoint
// appears when someone exposes it on a sandbox, which is done on another page.
export const useWorkspaceServices = (
  workspace: string,
  options: UseWorkspaceServicesOptions = {},
) =>
  useQuery({
    queryKey: workspaceKeys.services(workspace),
    queryFn: () => listWorkspaceServices(workspace),
    enabled: options.enabled ?? true,
    refetchInterval: RESOURCE_POLL_MS,
  });

export const useWorkspace = (name: string) =>
  useQuery({
    queryKey: workspaceKeys.detail(name),
    queryFn: () => getWorkspace(name),
    refetchInterval: RESOURCE_POLL_MS,
  });

export const useCreateWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
};

// A deleted workspace takes with it its own entry, and everything of its that
// the lists across workspaces show.
export const useDeleteWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
        queryClient.invalidateQueries({ queryKey: allWorkspacesKeys.all }),
      ]),
  });
};

export const useMembers = (workspace: string) =>
  useQuery({
    queryKey: workspaceKeys.members(workspace),
    queryFn: () => listMembers(workspace),
    refetchInterval: RESOURCE_POLL_MS,
  });

export const useAddMember = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMemberRequest) => addMember(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.members(workspace),
      }),
  });
};

export const useRemoveMember = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subject: string) => removeMember(workspace, subject),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.members(workspace),
      }),
  });
};
