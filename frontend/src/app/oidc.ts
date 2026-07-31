// Standalone OIDC Authorization Code + PKCE flow. The redirect to the IdP
// happens in the browser; the token exchange is proxied through the BFF to
// avoid CORS issues with the IdP's token endpoint.

import type { AuthConfig } from '../types';

const VERIFIER_KEY = 'openshell-dashboard.pkceVerifier';

type DiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
};

const discover = async (issuer: string): Promise<DiscoveryDocument> => {
  const response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status})`);
  }
  return (await response.json()) as DiscoveryDocument;
};

const base64UrlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const createVerifier = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
};

const challengeFromVerifier = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
};

export const redirectUri = (): string => `${window.location.origin}/auth/callback`;

// Begin the PKCE flow by redirecting the browser to the IdP.
export const startLogin = async (config: AuthConfig): Promise<void> => {
  if (!config.issuer || !config.clientId) {
    throw new Error('OIDC issuer and client ID are not configured on the BFF');
  }
  const discovery = await discover(config.issuer);
  const verifier = createVerifier();
  window.sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await challengeFromVerifier(verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'login',
  });
  window.location.assign(`${discovery.authorization_endpoint}?${params.toString()}`);
};

// Exchange the authorization code for tokens via the BFF proxy. The BFF
// calls the IdP's token endpoint server-side, avoiding CORS issues.
export const completeLogin = async (config: AuthConfig, code: string): Promise<{ accessToken: string; refreshToken?: string }> => {
  if (!config.issuer || !config.clientId) {
    throw new Error('OIDC issuer and client ID are not configured on the BFF');
  }
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error('Missing PKCE verifier — restart the login flow');
  }

  const response = await fetch('/api/v1/auth/token-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirectUri: redirectUri(),
      codeVerifier: verifier,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `Token exchange failed (${response.status})`);
  }

  const body = (await response.json()) as { accessToken: string; refreshToken?: string };
  window.sessionStorage.removeItem(VERIFIER_KEY);
  if (!body.accessToken) {
    throw new Error('Token exchange did not return an access token');
  }
  return body;
};
