// Generic OIDC Authorization Code + PKCE flow.
// Works with any standard OIDC provider (Dex, Keycloak, Okta, etc.).

const generateCodeVerifier = (): string => {
  const array = new Uint8Array(32);
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
  const codeVerifier = generateCodeVerifier();
  const challenge = base64url(await sha256(codeVerifier));

  sessionStorage.setItem('oidc.code_verifier', codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const discoveryResp = await fetch(
    `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
  );
  const discovery = (await discoveryResp.json()) as {
    authorization_endpoint: string;
  };

  window.location.assign(`${discovery.authorization_endpoint}?${params}`);
};

export const getCodeVerifier = (): string | null =>
  sessionStorage.getItem('oidc.code_verifier');

export const clearCodeVerifier = (): void => {
  sessionStorage.removeItem('oidc.code_verifier');
};
