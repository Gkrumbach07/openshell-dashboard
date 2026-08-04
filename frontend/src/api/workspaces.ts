import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, post } from './client';
import { workspaceKeys } from './queryKeys';
import type {
  AddMemberRequest,
  CreateWorkspaceRequest,
  Workspace,
  WorkspaceMember,
} from '../types';

export const listWorkspaces = (): Promise<Workspace[]> =>
  get<Workspace[]>('/api/v1/workspaces');

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

export const useWorkspaces = () =>
  useQuery({ queryKey: workspaceKeys.all, queryFn: listWorkspaces });

export const useWorkspace = (name: string) =>
  useQuery({
    queryKey: workspaceKeys.detail(name),
    queryFn: () => getWorkspace(name),
  });

export const useCreateWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
};

export const useDeleteWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
};

export const useMembers = (workspace: string) =>
  useQuery({
    queryKey: workspaceKeys.members(workspace),
    queryFn: () => listMembers(workspace),
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
