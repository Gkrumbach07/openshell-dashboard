import { useQuery } from '@tanstack/react-query';

import { STALE_5_MIN } from '../constants';
import { get } from './client';
import { authKeys } from './queryKeys';
import type { AuthConfig, CurrentUser, UserInfo } from '../types';

export const getAuthConfig = (): Promise<AuthConfig> =>
  get<AuthConfig>('/api/v1/auth/config');

export const getUserInfo = (): Promise<UserInfo> =>
  get<UserInfo>('/api/v1/auth/userinfo');

export const useAuthConfig = () =>
  useQuery({
    queryKey: authKeys.config,
    queryFn: getAuthConfig,
    staleTime: Infinity,
    retry: 1,
  });

export const useUserInfo = (enabled = true) =>
  useQuery({
    queryKey: authKeys.userInfo,
    queryFn: getUserInfo,
    enabled,
    retry: false,
  });

export const getCurrentUser = (): Promise<CurrentUser> =>
  get<CurrentUser>('/api/v1/auth/whoami');

export const useCurrentUser = () =>
  useQuery({
    queryKey: authKeys.whoami,
    queryFn: getCurrentUser,
    staleTime: STALE_5_MIN,
    retry: false,
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
    deploymentContext: 'standalone',
    workspaceBinding: false,
    resourceLinks: false,
  };
  return data?.features ?? defaults;
};
