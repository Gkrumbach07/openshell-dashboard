import { clearLoginState, getCodeVerifier, getState } from '../oidc';

// startLogin's PKCE path uses Web Crypto (SubtleCrypto + TextEncoder), which
// jsdom does not provide; it is exercised in the live dev/e2e flow. These
// tests cover the login-state lifecycle that unit tests can assert.
describe('oidc login state', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reads back a stored verifier and state', () => {
    window.sessionStorage.setItem('oidc.code_verifier', 'verifier-value');
    window.sessionStorage.setItem('oidc.state', 'state-value');
    expect(getCodeVerifier()).toBe('verifier-value');
    expect(getState()).toBe('state-value');
  });

  it('clearLoginState removes both verifier and state', () => {
    window.sessionStorage.setItem('oidc.code_verifier', 'v');
    window.sessionStorage.setItem('oidc.state', 's');
    clearLoginState();
    expect(getCodeVerifier()).toBeNull();
    expect(getState()).toBeNull();
  });
});
