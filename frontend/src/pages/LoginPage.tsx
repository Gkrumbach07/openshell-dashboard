import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  Stack,
  StackItem,
} from '@patternfly/react-core';

import { useAuthConfig } from '../api/auth';
import { setDevSession } from '../app/authStore';
import { startLogin } from '../app/oidc';

type LoginPageProps = {
  onAuthenticated: () => void;
};

// Standalone login. With AUTH_DISABLED=true on the BFF this offers a dev
// bypass; otherwise it starts the OIDC Authorization Code + PKCE redirect.
const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const authConfig = useAuthConfig();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const signIn = async () => {
    if (!authConfig.data) {
      return;
    }
    try {
      setRedirecting(true);
      await startLogin(authConfig.data);
    } catch (loginError) {
      setRedirecting(false);
      setError((loginError as Error).message);
    }
  };

  return (
    <Bullseye style={{ minHeight: '100vh' }}>
        <Card className="pf-v6-u-w-100" style={{ maxWidth: '28rem' }}>
          <CardTitle>OpenShell Dashboard</CardTitle>
          <CardBody>
            <Stack hasGutter>
              <StackItem>
                <Content component="p">
                  Admin UI for the OpenShell agent sandboxing gateway.
                </Content>
              </StackItem>
              {authConfig.isError && (
                <StackItem>
                  <Alert variant="danger" isInline title="Cannot reach the BFF">
                    {(authConfig.error as Error).message}
                  </Alert>
                </StackItem>
              )}
              {error && (
                <StackItem>
                  <Alert variant="danger" isInline title="Sign-in failed">
                    {error}
                  </Alert>
                </StackItem>
              )}
              {authConfig.data?.authDisabled ? (
                <StackItem>
                  <Alert variant="warning" isInline title="Authentication is disabled (dev mode)" />
                  <Button
                    className="pf-v6-u-mt-md"
                    onClick={() => {
                      setDevSession();
                      onAuthenticated();
                    }}
                    data-testid="dev-login"
                  >
                    Continue as developer
                  </Button>
                </StackItem>
              ) : (
                <StackItem>
                  <Button
                    onClick={signIn}
                    isDisabled={!authConfig.data || redirecting}
                    isLoading={redirecting}
                    data-testid="oidc-login"
                  >
                    Sign in with OIDC
                  </Button>
                </StackItem>
              )}
            </Stack>
          </CardBody>
        </Card>
    </Bullseye>
  );
};

export default LoginPage;
