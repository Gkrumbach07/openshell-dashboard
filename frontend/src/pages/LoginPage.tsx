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
import { useI18n } from '../i18n';
import type { AuthConfig } from '../types';

type LoginPageProps = {
  config?: AuthConfig;
  // Called after dev-mode login.
  onAuthenticated?: () => void;
};

// LoginPage only renders in dev mode (AUTH_DISABLED=true). In every other
// deployment the auth proxy in front of the BFF owns login (ADR 0002), so an
// unauthenticated browser never reaches this app.
const LoginPage: React.FC<LoginPageProps> = ({ config, onAuthenticated }) => {
  const { t } = useI18n('auth');

  return (
    <Bullseye style={{ minHeight: '100vh' }}>
      <Card className="pf-v6-u-w-100" style={{ maxWidth: '28rem' }}>
        <CardTitle>{t('title')}</CardTitle>
        <CardBody>
          <Stack hasGutter>
            <StackItem>
              <Content component="p">{t('description')}</Content>
            </StackItem>
            {config?.authDisabled ? (
              <StackItem>
                <Alert
                  variant="warning"
                  isInline
                  title={t('devDisabledTitle')}
                />
                <Button
                  className="pf-v6-u-mt-md"
                  onClick={() => {
                    setDevSession();
                    onAuthenticated?.();
                  }}
                  data-testid="dev-login"
                >
                  {t('continueAsDeveloper')}
                </Button>
              </StackItem>
            ) : (
              <StackItem>
                <Alert variant="info" isInline title={t('proxySignInTitle')}>
                  {t('proxySignInBody')}
                </Alert>
              </StackItem>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Bullseye>
  );
};

export default LoginPage;
