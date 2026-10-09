/** @jest-environment node */

import { getAuthConfig } from '../../api/auth';
import type { AuthConfig } from '../../types';
import { logout } from '../logout';

jest.mock('../../api/auth', () => ({ getAuthConfig: jest.fn() }));

const mockGetAuthConfig = getAuthConfig as jest.MockedFunction<
  typeof getAuthConfig
>;
const fetchMock = jest.fn();
const assign = jest.fn();
const replace = jest.fn();
const removeItem = jest.fn();
const originalFetch = global.fetch;

const authConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig =>
  ({ authDisabled: false, ...overrides }) as AuthConfig;

describe('logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { assign, replace }, sessionStorage: { removeItem } },
    });
    global.fetch = fetchMock as typeof fetch;
    mockGetAuthConfig.mockResolvedValue(authConfig());
  });

  afterAll(() => {
    global.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('waits for proxy sign-out before visiting sign-in, without following its root redirect', async () => {
    let finishSignOut!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finishSignOut = resolve;
      }),
    );

    const operation = logout();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith('/oauth2/sign_out', {
      credentials: 'same-origin',
      redirect: 'manual',
    });
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    finishSignOut({ type: 'opaqueredirect' } as Response);
    await operation;

    expect(replace).toHaveBeenCalledWith('/oauth2/sign_in');
    expect(assign).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith('openshell-dashboard.devMode');
  });

  it('navigates to proxy sign-out if the request fails or does not redirect', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await logout();
    expect(assign).toHaveBeenCalledWith('/oauth2/sign_out');
    expect(replace).not.toHaveBeenCalled();

    assign.mockClear();
    fetchMock.mockResolvedValueOnce({ type: 'basic', status: 500 });
    await logout();
    expect(assign).toHaveBeenCalledWith('/oauth2/sign_out');
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps custom proxy URLs as browser navigations', async () => {
    mockGetAuthConfig.mockResolvedValue(
      authConfig({ logoutUrl: '/platform/logout' }),
    );

    await logout();

    expect(assign).toHaveBeenCalledWith('/platform/logout');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps dev logout on the dev login page', async () => {
    mockGetAuthConfig.mockResolvedValue(authConfig({ authDisabled: true }));

    await logout();

    expect(assign).toHaveBeenCalledWith('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
