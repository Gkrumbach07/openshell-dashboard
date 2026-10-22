import { Content, PageSection, Title } from '@patternfly/react-core';

import { PLATFORM_PROFILE_SCOPE } from '../api/providers';
import { useUserRole } from '../api/rbac';
import ProfilesPanel from '../components/provider/ProfilesPanel';
import { useI18n } from '../i18n';

// The platform's provider profiles: the ones that belong to no workspace and
// that every workspace sees and can create providers from. It is the CLI's
// `provider profile ... --global`. The gateway answers the platform scope for
// platform admins only.
const ProviderProfilesPage: React.FC = () => {
  const { isPlatformAdmin } = useUserRole();
  const { t } = useI18n('common');
  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          {t('providerProfiles.title')}
        </Title>
        <Content component="p">{t('providerProfiles.description')}</Content>
      </PageSection>
      <PageSection>
        <ProfilesPanel
          scope={PLATFORM_PROFILE_SCOPE}
          canManage={isPlatformAdmin}
        />
      </PageSection>
    </>
  );
};

export default ProviderProfilesPage;
