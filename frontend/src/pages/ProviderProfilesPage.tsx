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
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          Provider profiles
        </Title>
        <Content component="p">
          Platform-scoped profiles for connecting sandboxes to external
          services, such as LLM inference backends, code repositories, or
          enterprise APIs. Every workspace can create providers from them and
          attach those providers to its sandboxes; a profile a workspace keeps
          itself with the same ID takes precedence there.
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
