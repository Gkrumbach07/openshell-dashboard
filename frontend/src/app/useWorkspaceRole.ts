import { useCurrentUser } from '../api/auth';
import { useMembers } from '../api/workspaces';
import { PLATFORM_ADMIN_ROLE } from './useUserRole';

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
