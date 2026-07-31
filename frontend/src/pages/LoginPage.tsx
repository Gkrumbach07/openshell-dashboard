import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';

import { useAuthConfig } from '../api/auth';
import { hasSession, setDevSession } from '../app/authStore';
import { startLogin } from '../app/oidc';

type LoginPageProps = {
  onAuthenticated: () => void;
};

const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const authConfig = useAuthConfig();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // If we already have a session (e.g. callback just stored the token but
  // the parent React state hasn't re-rendered yet), skip the login page.
  if (hasSession()) {
    onAuthenticated();
    return null;
  }

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
            {authConfig.isLoading && (
              <StackItem>
                <Bullseye>
                  <Spinner size="md" aria-label="Loading configuration" />
                </Bullseye>
              </StackItem>
            )}
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
            ) : authConfig.data ? (
              <StackItem>
                <Button
                  onClick={signIn}
                  isDisabled={redirecting}
                  isLoading={redirecting}
                  data-testid="oidc-login"
                >
                  Sign in with OIDC
                </Button>
              </StackItem>
            ) : null}
          </Stack>
        </CardBody>
      </Card>
    </Bullseye>
  );
};

export default LoginPage;
