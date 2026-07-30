import { useCurrentUser } from '../api/auth';

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
