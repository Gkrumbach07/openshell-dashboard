import { renderHook } from '@testing-library/react';

import { useUserRole } from '../rbac';

jest.mock('../auth', () => ({
  useAuthConfig: jest.fn(),
  useCurrentUser: jest.fn(),
}));

import { useAuthConfig, useCurrentUser } from '../auth';

const mockUseAuthConfig = useAuthConfig as jest.Mock;
const mockUseCurrentUser = useCurrentUser as jest.Mock;

const mockAuth = (
  roles: string[] | undefined,
  config: { adminRole?: string; userRole?: string } = {},
) => {
  mockUseAuthConfig.mockReturnValue({
    data: {
      adminRole: config.adminRole ?? 'openshell-admin',
      userRole: config.userRole ?? 'openshell-user',
    },
  });
  mockUseCurrentUser.mockReturnValue({
    data: roles === undefined ? undefined : { subject: 'user-1', roles },
    isLoading: false,
  });
};

describe('useUserRole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats configured user role as entitled', () => {
    mockAuth(['openshell-user']);
    const { result } = renderHook(() => useUserRole());

    expect(result.current.isUser).toBe(true);
    expect(result.current.isPlatformAdmin).toBe(false);
    expect(result.current.isUnentitled).toBe(false);
  });

  it('treats configured admin role as entitled and platform admin', () => {
    mockAuth(['openshell-admin']);
    const { result } = renderHook(() => useUserRole());

    expect(result.current.isUser).toBe(true);
    expect(result.current.isPlatformAdmin).toBe(true);
    expect(result.current.isUnentitled).toBe(false);
  });

  it('ignores Keycloak default roles for entitlement', () => {
    mockAuth([
      'offline_access',
      'default-roles-openshell',
      'uma_authorization',
    ]);
    const { result } = renderHook(() => useUserRole());

    expect(result.current.isUser).toBe(false);
    expect(result.current.isUnentitled).toBe(true);
  });

  it('is not unentitled before whoami succeeds', () => {
    mockAuth(undefined);
    const { result } = renderHook(() => useUserRole());

    expect(result.current.whoamiSucceeded).toBe(false);
    expect(result.current.isUnentitled).toBe(false);
  });
});
