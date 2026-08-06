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

// useSession probes the BFF's session endpoint to decide whether the browser
// is logged in (the session cookie is HttpOnly, so JS cannot check directly).
// Unlike whoami this never touches the gateway, so a gateway outage does not
// log the user out. Fetched directly (not via apiFetch) because a 401 here is
// the expected "not logged in" answer, not a session-expiry event.
export const useSession = (enabled: boolean) =>
  useQuery({
    queryKey: authKeys.session,
    queryFn: async () => {
      const resp = await fetch('/api/v1/auth/session');
      if (!resp.ok) {
        throw new Error(`not authenticated (${resp.status})`);
      }
      return (await resp.json()) as { authenticated: boolean };
    },
    enabled,
    retry: false,
    staleTime: STALE_5_MIN,
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
