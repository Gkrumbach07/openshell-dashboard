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
import type { AuthConfig } from '../types';

type LoginPageProps = {
  config?: AuthConfig;
  // Called after dev-mode login.
  onAuthenticated?: () => void;
};

// LoginPage only renders in dev mode (AUTH_DISABLED=true). In every other
// deployment the auth proxy in front of the BFF owns login (ADR 0002), so an
// unauthenticated browser never reaches this app.
const LoginPage: React.FC<LoginPageProps> = ({ config, onAuthenticated }) => (
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
              <Alert
                variant="info"
                isInline
                title="Sign-in is handled by this deployment's auth proxy"
              >
                Reload the page to be redirected to sign-in.
              </Alert>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  </Bullseye>
);

export default LoginPage;
