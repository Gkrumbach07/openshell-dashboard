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

import { setDevSession } from '../app/authStore';
import { startLogin } from '../app/oidc';
import type { AuthConfig } from '../types';

type LoginPageProps = {
  config?: AuthConfig;
  // Called after dev-mode login; OIDC login leaves the page for the IdP.
  onAuthenticated?: () => void;
};

const LoginPage: React.FC<LoginPageProps> = ({ config, onAuthenticated }) => {
  const [error, setError] = useState<string>();

  const handleOidcLogin = async () => {
    if (!config?.issuer || !config?.clientId) {
      setError('OIDC issuer and client ID are not configured on the BFF');
      return;
    }
    try {
      await startLogin(
        config.issuer,
        config.clientId,
        config.scopes || 'openid profile email groups',
        `${window.location.origin}/auth/callback`,
      );
    } catch (e) {
      setError((e as Error).message);
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
            {error && (
              <StackItem>
                <Alert variant="danger" isInline title="Sign-in failed">
                  {error}
                </Alert>
              </StackItem>
            )}
            {config?.authDisabled ? (
              <StackItem>
                <Alert
                  variant="warning"
                  isInline
                  title="Authentication is disabled (dev mode)"
                />
                <Button
                  className="pf-v6-u-mt-md"
                  onClick={() => {
                    setDevSession();
                    onAuthenticated?.();
                  }}
                  data-testid="dev-login"
                >
                  Continue as developer
                </Button>
              </StackItem>
            ) : (
              <StackItem>
                <Button
                  onClick={handleOidcLogin}
                  isBlock
                  data-testid="oidc-login"
                >
                  Sign in
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
