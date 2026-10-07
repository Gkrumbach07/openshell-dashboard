import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { CONFIG_POLL_MS } from '../constants';
import { apiFetch, del, get } from './client';
import { sandboxKeys, settingsKeys } from './queryKeys';
import type {
  GatewaySettings,
  SettingDeleteResult,
  SettingValue,
} from '../types';

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

// The answer is the gateway's own: `deleted` is false when the key had no
// global value, so there was nothing to delete.
export const deleteGlobalSetting = (
  key: string,
): Promise<SettingDeleteResult> =>
  del<SettingDeleteResult>(
    `/api/v1/settings/global?key=${encodeURIComponent(key)}`,
  );

// Polled: another platform admin, or the CLI, may change a setting while the
// page is open.
export const useGlobalSettings = () =>
  useQuery({
    queryKey: settingsKeys.global,
    queryFn: getGlobalSettings,
    refetchInterval: CONFIG_POLL_MS,
  });

// A global setting overrides the same key on every sandbox, so each sandbox's
// own settings read differently after one is written.
const invalidateSettings = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: settingsKeys.global }),
    queryClient.invalidateQueries({ queryKey: sandboxKeys.allSettings }),
  ]);

export const useSetGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: SettingValue }) =>
      setGlobalSetting(key, value),
    onSuccess: () => invalidateSettings(queryClient),
  });
};

export const useDeleteGlobalSetting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteGlobalSetting(key),
    onSuccess: () => invalidateSettings(queryClient),
  });
};
