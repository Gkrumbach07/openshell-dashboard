import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, del, get } from './client';
import { settingsKeys } from './queryKeys';
import type { GatewaySettings, SettingValue } from '../types';

export const getGlobalSettings = (): Promise<GatewaySettings> =>
  get<GatewaySettings>('/api/v1/settings/global');

// The JSON type of `value` is the type the gateway is sent: a string, a
// boolean or an integer. The BFF coerces nothing.
export const setGlobalSetting = (
  key: string,
  value: SettingValue,
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
    queryKey: settingsKeys.global,
    queryFn: getGlobalSettings,
  });

export const useSetGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: SettingValue }) =>
      setGlobalSetting(key, value),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.global }),
  });
};

export const useDeleteGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteGlobalSetting(key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.global }),
  });
};
