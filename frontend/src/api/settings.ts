import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, del, get } from './client';
import type { GatewaySettings } from '../types';

export const getGlobalSettings = (): Promise<GatewaySettings> =>
  get<GatewaySettings>('/api/v1/settings/global');

export const setGlobalSetting = (
  key: string,
  value: string,
): Promise<{ updated: boolean }> =>
  apiFetch<{ updated: boolean }>('/api/v1/settings/global', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });

export const deleteGlobalSetting = (
  key: string,
): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(
    `/api/v1/settings/global?key=${encodeURIComponent(key)}`,
  );

export const useGlobalSettings = () =>
  useQuery({
    queryKey: ['global-settings'],
    queryFn: getGlobalSettings,
  });

export const useSetGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      setGlobalSetting(key, value),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['global-settings'] }),
  });
};

export const useDeleteGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteGlobalSetting(key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['global-settings'] }),
  });
};
