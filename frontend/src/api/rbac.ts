import { useCurrentUser } from './auth';
import { useMembers } from './workspaces';

export const PLATFORM_ADMIN_ROLE = 'openshell-admin';
export const USER_ROLE = 'openshell-user';

export const useUserRole = () => {
  const { data: user } = useCurrentUser();
  const roles = user?.roles ?? [];
  return {
    isPlatformAdmin: roles.includes(PLATFORM_ADMIN_ROLE),
    isUser: roles.includes(USER_ROLE) || roles.includes(PLATFORM_ADMIN_ROLE),
    roles,
    subject: user?.subject,
  };
};

export const useWorkspaceRole = (workspace: string) => {
  const { data: user } = useCurrentUser();
  const members = useMembers(workspace);

  const isPlatformAdmin = (user?.roles ?? []).includes(PLATFORM_ADMIN_ROLE);

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
