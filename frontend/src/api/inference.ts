import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, del, get } from './client';
import { inferenceKeys } from './queryKeys';
import type { InferenceRoute, SetInferenceRouteRequest } from '../types';

const base = (workspace: string) =>
  `/api/v1/workspaces/${encodeURIComponent(workspace)}/inference`;

export const getInferenceRoute = (
  workspace: string,
  route: string,
): Promise<InferenceRoute> =>
  get<InferenceRoute>(
    `${base(workspace)}${route ? `?route=${encodeURIComponent(route)}` : ''}`,
  );

export const setInferenceRoute = (
  workspace: string,
  body: SetInferenceRouteRequest,
): Promise<InferenceRoute> =>
  apiFetch<InferenceRoute>(base(workspace), {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteInferenceRoute = (
  workspace: string,
  route: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `${base(workspace)}${route ? `?route=${encodeURIComponent(route)}` : ''}`,
  );

// route "" is the user-facing inference.local route; "sandbox-system" is the
// system route used by platform functions.
export const useInferenceRoute = (workspace: string, route: string) =>
  useQuery({
    queryKey: inferenceKeys.route(workspace, route),
    queryFn: () => getInferenceRoute(workspace, route),
    retry: false,
  });

export const useSetInferenceRoute = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetInferenceRouteRequest) =>
      setInferenceRoute(workspace, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: inferenceKeys.scope(workspace) }),
  });
};

export const useDeleteInferenceRoute = (workspace: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (route: string) => deleteInferenceRoute(workspace, route),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: inferenceKeys.scope(workspace) }),
  });
};
