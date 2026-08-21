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

import { useI18n } from '../i18n';

const AuthRequiredPage: React.FC = () => {
  const { t } = useI18n('auth');

  return (
    <Bullseye className="pf-v6-u-h-100vh">
      <Card
        className="pf-v6-u-w-100 pf-v6-u-max-width"
        style={
          {
            '--pf-v6-u-max-width--MaxWidth': '28rem',
          } as React.CSSProperties
        }
      >
        <CardTitle>{t('title')}</CardTitle>
        <CardBody>
          <Stack hasGutter>
            <StackItem>
              <Content component="p">{t('description')}</Content>
            </StackItem>
            <StackItem>
              <Alert
                variant="warning"
                isInline
                title={t('requiredTitle')}
                data-testid="auth-required"
              >
                {t('requiredLead')} <code>make dev</code>{' '}
                {t('requiredDevDefault')} <code>AUTH_DISABLED=true</code>
                {t('requiredAuthOn')} <code>AUTH_DISABLED=false make dev</code>{' '}
                {t('requiredDevServerNote')} <code>make dev-full</code>{' '}
                {t('requiredProxyNote')}
              </Alert>
            </StackItem>
          </Stack>
        </CardBody>
      </Card>
    </Bullseye>
  );
};

export default AuthRequiredPage;
