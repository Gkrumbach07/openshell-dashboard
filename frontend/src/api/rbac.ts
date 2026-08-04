import { useAuthConfig, useCurrentUser } from './auth';
import { useMembers } from './workspaces';

export const useUserRole = () => {
  const { data: config } = useAuthConfig();
  const { data: user, isLoading } = useCurrentUser();
  const roles = user?.roles ?? [];
  const adminRole = config?.adminRole ?? 'admin';
  return {
    isPlatformAdmin: roles.includes(adminRole),
    isUser: roles.length > 0,
    isLoading,
    roles,
    subject: user?.subject,
  };
};

export const useWorkspaceRole = (workspace: string) => {
  const { data: user } = useCurrentUser();
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
