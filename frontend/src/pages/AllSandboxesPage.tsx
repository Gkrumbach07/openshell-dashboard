import { useState } from 'react';
import { Content, PageSection, Title } from '@patternfly/react-core';
import { Link } from 'react-router-dom';

import { useAllSandboxes } from '../api/allWorkspaces';
import { useI18n } from '../i18n';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ResourceTable from '../components/ResourceTable';
import type { ResourceTableColumn } from '../components/ResourceTable';
import ImageReference from '../components/sandbox/ImageReference';
import { formatAge } from '../utils/formatters';
import {
  sandboxPath,
  scopedName,
  workspaceOf,
  workspacePath,
} from '../utils/workspaceNames';
import type { Sandbox } from '../types';

// The sandboxes of every workspace on the gateway: `openshell sandbox list
// --all-workspaces`. The gateway answers this for platform admins only, and
// its refusal is shown as it is. Each row names its workspace and leads to
// the workspace-scoped sandbox, which is where it is acted on.
const AllSandboxesPage: React.FC = () => {
  const { t } = useI18n('crossWorkspace');
  const [sandboxSelector, setSandboxSelector] = useState('');
  const sandboxes = useAllSandboxes(sandboxSelector || undefined);

  const columns: ResourceTableColumn<Sandbox>[] = [
    {
      title: t('sandboxes.columns.name'),
      modifier: 'nowrap',
      render: (sandbox) => (
        <Link
          to={sandboxPath(workspaceOf(sandbox), sandbox.metadata.name)}
          data-testid={`sandbox-link-${scopedName(sandbox)}`}
        >
          {sandbox.metadata.name}
        </Link>
      ),
    },
    {
      title: t('sandboxes.columns.workspace'),
      modifier: 'nowrap',
      render: (sandbox) => (
        <Link
          to={workspacePath(workspaceOf(sandbox))}
          data-testid={`workspace-link-${scopedName(sandbox)}`}
        >
          {workspaceOf(sandbox)}
        </Link>
      ),
    },
    {
      title: t('sandboxes.columns.status'),
      render: (sandbox) => (
        <PhaseLabel
          phase={sandbox.status.phase}
          exitCode={sandbox.status.exitCode}
        />
      ),
    },
    {
      title: t('sandboxes.columns.image'),
      modifier: 'truncate',
      render: (sandbox) => <ImageReference image={sandbox.spec.image} />,
    },
    {
      title: t('sandboxes.columns.labels'),
      render: (sandbox) => (
        <LabelsList labels={sandbox.metadata.labels} numLabels={2} />
      ),
    },
    {
      title: t('sandboxes.columns.age'),
      render: (sandbox) => formatAge(sandbox.metadata.createdAtMs),
    },
  ];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          {t('sandboxes.title')}
        </Title>
        <Content component="p">{t('sandboxes.description')}</Content>
      </PageSection>
      <PageSection>
        <ResourceTable
          title={t('sandboxes.tableTitle')}
          testId="all-sandboxes"
          query={sandboxes}
          columns={columns}
          rowKey={scopedName}
          filterText={scopedName}
          filterPlaceholder={t('sandboxes.filterPlaceholder')}
          emptyBody={t('sandboxes.empty')}
          labelSelector={{
            value: sandboxSelector,
            onApply: setSandboxSelector,
          }}
        />
      </PageSection>
    </>
  );
};

export default AllSandboxesPage;
