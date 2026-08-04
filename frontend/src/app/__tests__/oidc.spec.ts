/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://dashboard.example.com/"}
 */
import { webcrypto } from 'node:crypto';
import { TextEncoder as NodeTextEncoder } from 'node:util';

import { redirectUri, startLogin, completeLogin } from '../oidc';
import type { AuthConfig } from '../../types';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  }
  if (typeof globalThis.TextEncoder === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).TextEncoder = NodeTextEncoder;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
});

const baseConfig: AuthConfig = {
  authDisabled: false,
  issuer: 'https://keycloak.example.com/realms/openshell',
  clientId: 'dashboard',
  features: {
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
  },
};

describe('redirectUri', () => {
  it('returns origin + /auth/callback', () => {
    expect(redirectUri()).toBe('https://dashboard.example.com/auth/callback');
  });
});

describe('startLogin', () => {
  it('throws when issuer is missing', async () => {
    await expect(
      startLogin({ ...baseConfig, issuer: undefined }),
    ).rejects.toThrow('OIDC issuer and client ID are not configured');
  });

  it('throws when clientId is missing', async () => {
    await expect(
      startLogin({ ...baseConfig, clientId: undefined }),
    ).rejects.toThrow('OIDC issuer and client ID are not configured');
  });

  it('stores a valid base64url PKCE verifier and calls discovery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          authorization_endpoint: 'https://example.com/auth',
          token_endpoint: 'https://example.com/token',
        }),
    });

    // startLogin calls location.assign which jsdom rejects as "Not
    // implemented: navigation". Suppress the error and verify side-effects.
    const origError = console.error;
    console.error = jest.fn();
    try {
      await startLogin(baseConfig);
    } catch {
      // jsdom may throw on navigation
    }
    console.error = origError;

    const verifier = window.sessionStorage.getItem(
      'openshell-dashboard.pkceVerifier',
    );
    expect(verifier).toBeTruthy();
    // Verifier must be base64url-safe (no +, /, =).
    expect(verifier).not.toMatch(/[+/=]/);

    // Discovery was called via the BFF proxy.
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/discovery');
  });
});

describe('completeLogin', () => {
  it('throws when verifier is missing from session storage', async () => {
    await expect(completeLogin(baseConfig, 'auth-code')).rejects.toThrow(
      'Missing PKCE verifier',
    );
  });

  it('sends correct POST body to token-exchange endpoint', async () => {
    window.sessionStorage.setItem(
      'openshell-dashboard.pkceVerifier',
      'test-verifier-123',
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }),
    });

    const result = await completeLogin(baseConfig, 'auth-code-xyz');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBe('new-refresh-token');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/auth/token-exchange');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.code).toBe('auth-code-xyz');
    expect(body.codeVerifier).toBe('test-verifier-123');
    expect(body.redirectUri).toBe(
      'https://dashboard.example.com/auth/callback',
    );

    expect(
      window.sessionStorage.getItem('openshell-dashboard.pkceVerifier'),
    ).toBeNull();
  });

  it('throws when token exchange fails', async () => {
    window.sessionStorage.setItem(
      'openshell-dashboard.pkceVerifier',
      'test-verifier',
    );

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({ message: 'Invalid authorization code' }),
    });

    await expect(completeLogin(baseConfig, 'bad-code')).rejects.toThrow(
      'Invalid authorization code',
    );
  });

  it('throws when response lacks accessToken', async () => {
    window.sessionStorage.setItem(
      'openshell-dashboard.pkceVerifier',
      'test-verifier',
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(completeLogin(baseConfig, 'code')).rejects.toThrow(
      'Token exchange did not return an access token',
    );
  });
});
