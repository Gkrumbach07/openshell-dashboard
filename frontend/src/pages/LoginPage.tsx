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

type LoginPageProps = {
  onAuthenticated: () => void;
};

const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => (
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
              title="Authentication is disabled (dev mode)"
            />
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
        </Stack>
      </CardBody>
    </Card>
  </Bullseye>
);

export default LoginPage;
