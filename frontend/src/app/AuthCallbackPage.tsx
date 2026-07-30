import { useEffect, useRef, useState } from 'react';
import { Alert, Bullseye, Button, Spinner } from '@patternfly/react-core';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getAuthConfig } from '../api/auth';
import { clearToken, setRefreshToken, setToken } from './authStore';
import { completeLogin } from './oidc';

const AuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const idpError = searchParams.get('error');
    if (idpError) {
      setError(searchParams.get('error_description') || idpError);
      return;
    }
    if (!code || exchanged.current) {
      return;
    }
    exchanged.current = true;
    (async () => {
      try {
        const config = await getAuthConfig();
        const result = await completeLogin(config, code);
        setToken(result.accessToken);
        if (result.refreshToken) {
          setRefreshToken(result.refreshToken);
        }
        navigate('/gateway', { replace: true });
      } catch (exchangeError) {
        setError((exchangeError as Error).message);
      }
    })();
  }, [searchParams, navigate]);

  return (
    <Bullseye style={{ minHeight: '100vh' }}>
      {error ? (
        <Alert
          variant="danger"
          title="Sign-in failed"
          actionLinks={
            <Button
              variant="link"
              onClick={() => {
                clearToken();
                window.location.assign('/login');
              }}
            >
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      ) : (
        <Spinner aria-label="Completing sign-in" />
      )}
    </Bullseye>
  );
};

export default AuthCallbackPage;
