import { useAuthConfig, useCurrentUser } from './auth';
import { useMembers } from './workspaces';

export const useUserRole = () => {
  const { data: config } = useAuthConfig();
  const { data: user, isLoading } = useCurrentUser({
    notifySessionExpired: false,
  });
  const roles = user?.roles ?? [];
  const adminRole = config?.adminRole ?? 'admin';
  const userRole = config?.userRole ?? 'user';
  // Whoami success is separate from entitlement: a signed-in user with no
  // configured OpenShell role is unentitled. The gateway returns the roles
  // claim unfiltered, so Keycloak defaults (offline_access, default-roles-*)
  // must not count — only adminRole and userRole do.
  const whoamiSucceeded = user != null;
  const isPlatformAdmin = roles.includes(adminRole);
  const isUser = isPlatformAdmin || roles.includes(userRole);
  return {
    isPlatformAdmin,
    isUser,
    whoamiSucceeded,
    isUnentitled: whoamiSucceeded && !isUser,
    isLoading,
    roles,
    subject: user?.subject,
  };
};

export const useWorkspaceRole = (workspace: string) => {
  const { data: user } = useCurrentUser({ notifySessionExpired: false });
  const members = useMembers(workspace);
  const { isPlatformAdmin } = useUserRole();

  if (isPlatformAdmin) {
    return { isWorkspaceAdmin: true, isLoading: false };
  }

  const currentMember = (members.data ?? []).find(
    (m) => m.principalSubject === user?.subject,
  );

  return {
    isWorkspaceAdmin: currentMember?.role === 'ADMIN',
    isLoading: members.isLoading,
  };
};
