import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Content,
  Stack,
  StackItem,
} from '@patternfly/react-core';

const AuthRequiredPage: React.FC = () => (
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
          <StackItem>
            <Alert
              variant="warning"
              isInline
              title="Authentication required"
              data-testid="auth-required"
            >
              This deployment requires a signed-in session. For local
              development, run <code>make dev</code> (defaults to{' '}
              <code>AUTH_DISABLED=true</code>). To test with auth enabled, use{' '}
              <code>AUTH_DISABLED=false make dev</code> — note that the Vite dev
              server is not behind an auth proxy, so browser sign-in is not
              available without <code>make dev-full</code> and a fronting proxy.
            </Alert>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  </Bullseye>
);

export default AuthRequiredPage;
