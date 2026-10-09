import { useQuery } from '@tanstack/react-query';

import { STALE_5_MIN } from '../constants';
import { get } from './client';
import { authKeys } from './queryKeys';
import type { AuthConfig, CurrentUser } from '../types';

export const getAuthConfig = (): Promise<AuthConfig> =>
  get<AuthConfig>('/api/v1/auth/config');

export const useAuthConfig = () =>
  useQuery({
    queryKey: authKeys.config,
    queryFn: getAuthConfig,
    staleTime: Infinity,
    retry: 1,
  });

const fetchCurrentUser = (notifySessionExpired?: boolean) =>
  notifySessionExpired === undefined
    ? get<CurrentUser>('/api/v1/auth/whoami')
    : get<CurrentUser>('/api/v1/auth/whoami', { notifySessionExpired });

export const getCurrentUser = (): Promise<CurrentUser> => fetchCurrentUser();

type UseCurrentUserOptions = {
  enabled?: boolean;
  /**
   * Notify the shared session-expired handler for 401 responses. Defaults to true.
   */
  notifySessionExpired?: boolean;
};

export const useCurrentUser = (options: UseCurrentUserOptions = {}) =>
  useQuery({
    queryKey: authKeys.whoami,
    queryFn:
      options.notifySessionExpired === undefined
        ? getCurrentUser
        : () => fetchCurrentUser(options.notifySessionExpired),
    staleTime: STALE_5_MIN,
    retry: false,
    enabled: options.enabled ?? true,
  });

export const useFeatureFlags = () => {
  const { data } = useAuthConfig();
  const defaults: import('../types').FeatureFlags = {
    terminal: true,
    fileTransfer: true,
    settings: true,
    globalPolicy: true,
    credentialRefresh: true,
    services: true,
    draftPolicy: true,
  };
  return data?.features ?? defaults;
};
