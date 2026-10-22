import { Content, PageSection, Title } from '@patternfly/react-core';

import AllSandboxList from '../components/AllSandboxList';
import { useI18n } from '../i18n';

// The sandboxes of every workspace on the gateway: `openshell sandbox list
// --all-workspaces`, a page at a time. The gateway answers this for platform
// admins only, and its refusal is shown as it is. Each row names its
// workspace and leads to the workspace-scoped sandbox, which is where it is
// acted on. The list is the one the gateway pages (AllSandboxList), with its
// label and type filters.
const AllSandboxesPage: React.FC = () => {
  const { t } = useI18n('crossWorkspace');

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          {t('sandboxes.title')}
        </Title>
        <Content component="p">{t('sandboxes.description')}</Content>
      </PageSection>
      <PageSection>
        <AllSandboxList />
      </PageSection>
    </>
  );
};

export default AllSandboxesPage;
