import { useEffect } from 'react';
import { Bullseye, Spinner } from '@patternfly/react-core';

import { setToken, setRefreshToken } from './authStore';
import { clearCodeVerifier, getCodeVerifier } from './oidc';

const AuthCallbackPage: React.FC = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const codeVerifier = getCodeVerifier();

    if (!code || !codeVerifier) {
      window.location.assign('/login');
      return;
    }

    const exchange = async () => {
      const resp = await fetch('/api/v1/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier,
          redirectUri: `${window.location.origin}/auth/callback`,
        }),
      });

      if (!resp.ok) {
        clearCodeVerifier();
        window.location.assign('/login');
        return;
      }

      const body = (await resp.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };

      if (body.accessToken) {
        setToken(body.accessToken);
        if (body.refreshToken) {
          setRefreshToken(body.refreshToken);
        }
      }

      clearCodeVerifier();
      window.location.assign('/workspaces');
    };

    exchange();
  }, []);

  return (
    <Bullseye style={{ minHeight: '100vh' }}>
      <Spinner aria-label="Signing in" />
    </Bullseye>
  );
};

export default AuthCallbackPage;
