import { useState } from 'react';
import {
  Badge,
  Button,
  Content,
  Label,
  LabelGroup,
  PageSection,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';

import {
  useAllProviders,
  useAllSandboxes,
  useAllServices,
  useAllTemplates,
} from '../api/allWorkspaces';
import { useFeatureFlags } from '../api/auth';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ResourceTable from '../components/ResourceTable';
import type { ResourceTableColumn } from '../components/ResourceTable';
import ServiceEndpointsTable from '../components/ServiceEndpointsTable';
import { formatAge } from '../utils/formatters';
import type { Provider, Sandbox, SandboxTemplate } from '../types';

type AllWorkspacesPageProps = {
  onSelectWorkspace?: (workspace: string) => void;
  // tab is the tab of the sandbox page to open, when not its first.
  onSelectSandbox?: (workspace: string, name: string, tab?: string) => void;
  onSelectProvider?: (workspace: string, name: string) => void;
};

const TabPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pf-v6-u-pt-lg">{children}</div>
);

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

// The sandboxes, providers, templates and service endpoints of every
// workspace on the gateway: `--all-workspaces` on the CLI's four lists. The
// gateway answers these for platform admins only, and its refusal is shown as
// it is. Each row names its workspace and leads to the workspace-scoped page
// for the resource, which is where it is acted on.
const AllWorkspacesPage: React.FC<AllWorkspacesPageProps> = ({
  onSelectWorkspace,
  onSelectSandbox,
  onSelectProvider,
}) => {
  const navigate = useNavigate();
  const features = useFeatureFlags();
  const [activeTab, setActiveTab] = useState<string | number>('sandboxes');
  const [sandboxSelector, setSandboxSelector] = useState('');
  const [templateSelector, setTemplateSelector] = useState('');
  const sandboxes = useAllSandboxes(sandboxSelector || undefined);
  const providers = useAllProviders();
  const templates = useAllTemplates(templateSelector || undefined);
  const services = useAllServices({ enabled: features.services });

  const selectWorkspace =
    onSelectWorkspace ??
    ((workspace: string) => navigate(`/workspaces/${workspace}`));
  const selectSandbox =
    onSelectSandbox ??
    ((workspace: string, name: string, tab?: string) =>
      navigate(
        `/workspaces/${workspace}/sandboxes/${name}${tab ? `?tab=${tab}` : ''}`,
      ));
  const selectProvider =
    onSelectProvider ??
    ((workspace: string, name: string) =>
      navigate(`/workspaces/${workspace}/providers/${name}`));

  const workspaceColumn = <
    T extends { metadata: { workspace?: string; name: string } },
  >(): ResourceTableColumn<T> => ({
    title: 'Workspace',
    modifier: 'nowrap',
    render: (item) => (
      <Button
        variant="link"
        isInline
        onClick={() => selectWorkspace(workspaceOf(item))}
      >
        {workspaceOf(item)}
      </Button>
    ),
  });

  const sandboxColumns: ResourceTableColumn<Sandbox>[] = [
    workspaceColumn<Sandbox>(),
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

  const providerColumns: ResourceTableColumn<Provider>[] = [
    workspaceColumn<Provider>(),
    {
      title: 'Name',
      modifier: 'nowrap',
      render: (provider) => (
        <Button
          variant="link"
          isInline
          onClick={() =>
            selectProvider(workspaceOf(provider), provider.metadata.name)
          }
          data-testid={`provider-link-${scopedName(provider)}`}
        >
          {provider.metadata.name}
        </Button>
      ),
    },
    {
      title: 'Type',
      render: (provider) => <Label color="purple">{provider.type}</Label>,
    },
    {
      title: 'Credentials',
      render: (provider) =>
        (provider.credentialNames ?? []).length > 0 ? (
          <LabelGroup numLabels={2}>
            {(provider.credentialNames ?? []).map((name) => (
              <Label key={name} color="grey" isCompact>
                {name}
              </Label>
            ))}
          </LabelGroup>
        ) : (
          '-'
        ),
    },
    {
      title: 'Config keys',
      render: (provider) => Object.keys(provider.config ?? {}).length,
    },
    {
      title: 'Age',
      render: (provider) => formatAge(provider.metadata.createdAtMs),
    },
  ];

  const templateColumns: ResourceTableColumn<SandboxTemplate>[] = [
    workspaceColumn<SandboxTemplate>(),
    {
      title: 'Name',
      modifier: 'nowrap',
      render: (template) => <strong>{template.metadata.name}</strong>,
    },
    {
      title: 'Image',
      modifier: 'truncate',
      render: (template) => (
        <ImageReference image={template.spec.workload?.image} />
      ),
    },
    {
      title: 'Labels',
      render: (template) => (
        <LabelsList labels={template.metadata.labels} numLabels={2} />
      ),
    },
    {
      title: 'Age',
      render: (template) => formatAge(template.metadata.createdAtMs),
    },
  ];

  const count = (data: unknown[] | undefined) =>
    data && <Badge isRead>{data.length}</Badge>;

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">All workspaces</Title>
        <Content component="p">
          Sandboxes, providers, templates and services across every workspace on
          the gateway. Select a row to open it in its workspace.
        </Content>
      </PageSection>
      <PageSection>
        <Tabs
          activeKey={activeTab}
          onSelect={(_event, key) => setActiveTab(key)}
          aria-label="Resources in all workspaces"
        >
          <Tab
            eventKey="sandboxes"
            title={
              <TabTitleText>Sandboxes {count(sandboxes.data)}</TabTitleText>
            }
            data-testid="all-tab-sandboxes"
          >
            <TabPanel>
              <ResourceTable
                title="Sandboxes"
                testId="all-sandboxes"
                query={sandboxes}
                columns={sandboxColumns}
                rowKey={scopedName}
                filterText={scopedName}
                filterPlaceholder="Filter by workspace or name"
                emptyBody="No workspace on this gateway has a sandbox."
                labelSelector={{
                  value: sandboxSelector,
                  onApply: setSandboxSelector,
                }}
              />
            </TabPanel>
          </Tab>
          <Tab
            eventKey="providers"
            title={
              <TabTitleText>Providers {count(providers.data)}</TabTitleText>
            }
            data-testid="all-tab-providers"
          >
            <TabPanel>
              <ResourceTable
                title="Providers"
                testId="all-providers"
                query={providers}
                columns={providerColumns}
                rowKey={scopedName}
                filterText={(provider) =>
                  `${scopedName(provider)} ${provider.type}`
                }
                filterPlaceholder="Filter by workspace, name or type"
                emptyBody="No workspace on this gateway has a provider."
              />
            </TabPanel>
          </Tab>
          <Tab
            eventKey="templates"
            title={
              <TabTitleText>Templates {count(templates.data)}</TabTitleText>
            }
            data-testid="all-tab-templates"
          >
            <TabPanel>
              <ResourceTable
                title="Templates"
                testId="all-templates"
                query={templates}
                columns={templateColumns}
                rowKey={scopedName}
                filterText={scopedName}
                filterPlaceholder="Filter by workspace or name"
                emptyBody="No workspace on this gateway has a sandbox template."
                labelSelector={{
                  value: templateSelector,
                  onApply: setTemplateSelector,
                }}
              />
            </TabPanel>
          </Tab>
          {features.services && (
            <Tab
              eventKey="services"
              title={
                <TabTitleText>Services {count(services.data)}</TabTitleText>
              }
              data-testid="all-tab-services"
            >
              <TabPanel>
                <ServiceEndpointsTable
                  query={services}
                  onSelectWorkspace={selectWorkspace}
                  onSelectSandbox={(workspace, name) =>
                    selectSandbox(workspace, name, 'services')
                  }
                />
              </TabPanel>
            </Tab>
          )}
        </Tabs>
      </PageSection>
    </>
  );
};

export default AllWorkspacesPage;
