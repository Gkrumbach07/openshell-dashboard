import { useQuery } from '@tanstack/react-query';

import { get } from './client';
import type { AuthConfig, CurrentUser, UserInfo } from '../types';

export const getAuthConfig = (): Promise<AuthConfig> => get<AuthConfig>('/api/v1/auth/config');

export const getUserInfo = (): Promise<UserInfo> => get<UserInfo>('/api/v1/auth/userinfo');

export const useAuthConfig = () =>
  useQuery({
    queryKey: ['auth', 'config'],
    queryFn: getAuthConfig,
    staleTime: Infinity,
    retry: 1,
  });

export const useUserInfo = (enabled = true) =>
  useQuery({
    queryKey: ['auth', 'userinfo'],
    queryFn: getUserInfo,
    enabled,
    retry: false,
  });

export const getCurrentUser = (): Promise<CurrentUser> => get<CurrentUser>('/api/v1/auth/whoami');

export const useCurrentUser = () =>
  useQuery({
    queryKey: ['auth', 'whoami'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
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
  };
  return data?.features ?? defaults;
};
