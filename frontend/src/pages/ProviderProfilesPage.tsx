import { Content, PageSection, Title } from '@patternfly/react-core';

import { PLATFORM_PROFILE_SCOPE } from '../api/providers';
import { useUserRole } from '../api/rbac';
import ProfilesPanel from '../components/provider/ProfilesPanel';

// The platform's provider profiles: the ones that belong to no workspace and
// that every workspace sees and can create providers from. It is the CLI's
// `provider profile ... --global`. The gateway answers the platform scope for
// platform admins only.
const ProviderProfilesPage: React.FC = () => {
  const { isPlatformAdmin } = useUserRole();
  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Provider profiles</Title>
        <Content component="p">
          Platform-scoped provider profiles. Every workspace sees them and can
          create providers from them; a workspace keeps profiles of its own on
          its Profiles tab, and one of those takes precedence there over a
          platform profile with the same ID. Platform Admin only.
        </Content>
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
