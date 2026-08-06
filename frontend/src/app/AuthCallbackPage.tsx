import { useEffect, useState } from 'react';
import { Alert, Bullseye, Button, Spinner } from '@patternfly/react-core';

import { clearLoginState, getCodeVerifier, getState } from './oidc';

const AuthCallbackPage: React.FC = () => {
  const [error, setError] = useState<string>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // The IdP can redirect back with an error (access_denied, consent
    // required, …) instead of a code. Surface it rather than silently
    // bouncing to /login, where the user would loop with no explanation.
    const idpError = params.get('error');
    if (idpError) {
      clearLoginState();
      setError(params.get('error_description') || idpError);
      return;
    }

    const code = params.get('code');
    const returnedState = params.get('state');
    const codeVerifier = getCodeVerifier();
    const expectedState = getState();

    // Reject the callback unless the IdP echoed back the exact `state` we
    // generated: this is the CSRF / code-injection guard for the redirect.
    if (
      !code ||
      !codeVerifier ||
      !expectedState ||
      returnedState !== expectedState
    ) {
      clearLoginState();
      window.location.assign('/login');
      return;
    }

    const exchange = async () => {
      // The BFF exchanges the code server-side and sets the HttpOnly session
      // cookie on this response. No tokens ever reach JavaScript.
      const resp = await fetch('/api/v1/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier,
          redirectUri: `${window.location.origin}/auth/callback`,
        }),
      });

      clearLoginState();
      window.location.assign(resp.ok ? '/workspaces' : '/login');
    };

    exchange();
  }, []);

  if (error) {
    return (
      <Bullseye style={{ minHeight: '100vh' }}>
        <Alert
          variant="danger"
          title="Sign-in failed"
          data-testid="callback-error"
        >
          {error}
          <div className="pf-v6-u-mt-md">
            <Button component="a" href="/login" variant="primary">
              Back to sign in
            </Button>
          </div>
        </Alert>
      </Bullseye>
    );
  }

  return (
    <Bullseye style={{ minHeight: '100vh' }}>
      <Spinner aria-label="Signing in" />
    </Bullseye>
  );
};

export default AuthCallbackPage;
