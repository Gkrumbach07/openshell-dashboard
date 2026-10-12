import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
} from '@patternfly/react-core';
import { LockIcon } from '@patternfly/react-icons';

import { logout } from '../app/logout';
import { useI18n } from '../i18n';

const EntitlementPage: React.FC = () => {
  const { t } = useI18n('auth');

  return (
    <PageSection>
      <EmptyState
        variant="lg"
        titleText={t('entitlementTitle')}
        icon={LockIcon}
        data-testid="entitlement-screen"
      >
        <EmptyStateBody>{t('entitlementBody')}</EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button
              variant="secondary"
              onClick={() => void logout()}
              data-testid="entitlement-sign-out"
            >
              {t('entitlementSignOut')}
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    </PageSection>
  );
};

export default EntitlementPage;
