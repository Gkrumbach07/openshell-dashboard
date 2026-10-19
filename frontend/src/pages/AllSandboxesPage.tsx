import { useState } from 'react';
import { Button, Content, PageSection, Title } from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';

import { useAllSandboxes } from '../api/allWorkspaces';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ResourceTable from '../components/ResourceTable';
import type { ResourceTableColumn } from '../components/ResourceTable';
import { formatAge } from '../utils/formatters';
import type { Sandbox } from '../types';

type AllSandboxesPageProps = {
  onSelectWorkspace?: (workspace: string) => void;
  onSelectSandbox?: (workspace: string, name: string) => void;
};

const workspaceOf = (item: { metadata: { workspace?: string } }): string =>
  item.metadata.workspace ?? '';

// A name is only unique within its workspace, so rows are keyed, and
// filtered, on both.
const scopedName = (item: {
  metadata: { workspace?: string; name: string };
}): string => `${workspaceOf(item)}/${item.metadata.name}`;

// An image reference pinned by digest is far wider than its column, which
// truncates it. The title keeps the whole reference within reach.
const ImageReference: React.FC<{ image?: string }> = ({ image }) =>
  image ? (
    <span className="pf-v6-u-font-family-monospace" title={image}>
      {image}
    </span>
  ) : (
    <>-</>
  );

// The sandboxes of every workspace on the gateway: `openshell sandbox list
// --all-workspaces`. The gateway answers this for platform admins only, and
// its refusal is shown as it is. Each row names its workspace and leads to
// the workspace-scoped sandbox, which is where it is acted on.
const AllSandboxesPage: React.FC<AllSandboxesPageProps> = ({
  onSelectWorkspace,
  onSelectSandbox,
}) => {
  const navigate = useNavigate();
  const [sandboxSelector, setSandboxSelector] = useState('');
  const sandboxes = useAllSandboxes(sandboxSelector || undefined);

  const selectWorkspace =
    onSelectWorkspace ??
    ((workspace: string) => navigate(`/workspaces/${workspace}`));
  const selectSandbox =
    onSelectSandbox ??
    ((workspace: string, name: string) =>
      navigate(`/workspaces/${workspace}/sandboxes/${name}`));

  const columns: ResourceTableColumn<Sandbox>[] = [
    {
      title: 'Name',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Button
          variant="link"
          isInline
          onClick={() =>
            selectSandbox(workspaceOf(sandbox), sandbox.metadata.name)
          }
          data-testid={`sandbox-link-${scopedName(sandbox)}`}
        >
          {sandbox.metadata.name}
        </Button>
      ),
    },
    {
      title: 'Workspace',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Button
          variant="link"
          isInline
          onClick={() => selectWorkspace(workspaceOf(sandbox))}
        >
          {workspaceOf(sandbox)}
        </Button>
      ),
    },
    {
      title: 'Status',
      render: (sandbox) => (
        <PhaseLabel
          phase={sandbox.status.phase}
          exitCode={sandbox.status.exitCode}
        />
      ),
    },
    {
      title: 'Image',
      modifier: 'truncate',
      render: (sandbox) => <ImageReference image={sandbox.spec.image} />,
    },
    {
      title: 'Labels',
      render: (sandbox) => (
        <LabelsList labels={sandbox.metadata.labels} numLabels={2} />
      ),
    },
    {
      title: 'Age',
      render: (sandbox) => formatAge(sandbox.metadata.createdAtMs),
    },
  ];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          Sandboxes
        </Title>
        <Content component="p">
          Secure execution environments for agents and tools, across every
          workspace on the gateway.
        </Content>
      </PageSection>
      <PageSection>
        <ResourceTable
          title="Sandboxes"
          testId="all-sandboxes"
          query={sandboxes}
          columns={columns}
          rowKey={scopedName}
          filterText={scopedName}
          filterPlaceholder="Filter by workspace or name"
          emptyBody="No workspace on this gateway has a sandbox."
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
