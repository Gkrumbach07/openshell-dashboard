// Generic OIDC Authorization Code + PKCE flow.
// Works with any standard OIDC provider (Dex, Keycloak, Okta, Entra, etc.).

const VERIFIER_KEY = 'oidc.code_verifier';
const STATE_KEY = 'oidc.state';

const randomHex = (bytes: number): string => {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
};

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
};

const base64url = (buffer: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const startLogin = async (
  issuer: string,
  clientId: string,
  scopes: string,
  redirectUri: string,
): Promise<void> => {
  const codeVerifier = randomHex(32);
  const challenge = base64url(await sha256(codeVerifier));
  // `state` binds the callback to this browser: the IdP echoes it back and
  // the callback rejects any mismatch, defeating login CSRF / code
  // injection. Required by the OAuth browser-based-apps BCP even with PKCE.
  const state = randomHex(16);

  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const discoveryResp = await fetch('/api/v1/auth/discovery');
  const discovery = (await discoveryResp.json()) as {
    authorization_endpoint: string;
  };

  window.location.assign(`${discovery.authorization_endpoint}?${params}`);
};

export const getCodeVerifier = (): string | null =>
  sessionStorage.getItem(VERIFIER_KEY);

export const getState = (): string | null => sessionStorage.getItem(STATE_KEY);

export const clearLoginState = (): void => {
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
};
