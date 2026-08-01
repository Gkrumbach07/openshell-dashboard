import { useAuthConfig, useCurrentUser } from './auth';
import { useMembers } from './workspaces';

export const useUserRole = () => {
  const { data: config } = useAuthConfig();
  const { data: user } = useCurrentUser();
  const roles = user?.roles ?? [];
  const adminRole = config?.adminRole ?? 'openshell-admin';
  const userRole = config?.userRole ?? 'openshell-user';
  return {
    isPlatformAdmin: roles.includes(adminRole),
    isUser: roles.includes(userRole) || roles.includes(adminRole),
    roles,
    subject: user?.subject,
  };
};

export const useWorkspaceRole = (workspace: string) => {
  const { data: config } = useAuthConfig();
  const { data: user } = useCurrentUser();
  const members = useMembers(workspace);
  const adminRole = config?.adminRole ?? 'openshell-admin';

  const isPlatformAdmin = (user?.roles ?? []).includes(adminRole);

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
