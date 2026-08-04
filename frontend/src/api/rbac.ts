import { useCurrentUser } from './auth';
import { useMembers } from './workspaces';

export const useUserRole = () => {
  const { data: user } = useCurrentUser();
  const roles = user?.roles ?? [];
  return {
    isPlatformAdmin: roles.some((r) => r.toLowerCase().includes('admin')),
    isUser: roles.length > 0,
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
