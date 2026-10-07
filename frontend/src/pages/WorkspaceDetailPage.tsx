import { useState } from 'react';
import {
  Alert,
  Badge,
  Bullseye,
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  PageSection,
  Spinner,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';

import { useFeatureFlags } from '../api/auth';
import { useProviders } from '../api/providers';
import { useSandboxes } from '../api/sandboxes';
import { useTemplates } from '../api/templates';
import {
  useMembers,
  useWorkspace,
  useWorkspaceServices,
} from '../api/workspaces';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ProfilesTab from '../components/provider/ProfilesTab';
import RefreshErrorAlert, {
  isRefreshError,
} from '../components/RefreshErrorAlert';
import ServiceEndpointsTable from '../components/ServiceEndpointsTable';
import TemplatesTab from '../components/TemplatesTab';
import { useSlots } from '../slots';
import { formatTimestamp } from '../utils/formatters';
import MemberListPage from './MemberListPage';
import ProviderListPage from './ProviderListPage';
import SandboxListPage from './SandboxListPage';
import type { CredentialInputSlot } from '../types';

type WorkspaceDetailPageProps = {
  workspace: string;
  onSelectSandbox?: (name: string) => void;
  onViewSandbox?: (name: string, tab?: string) => void;
  onSelectProvider?: (name: string) => void;
  renderCredentialInput?: CredentialInputSlot;
};

const TabPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pf-v6-u-pt-lg">{children}</div>
);

const WorkspaceDetailPage: React.FC<WorkspaceDetailPageProps> = ({
  workspace,
  onSelectSandbox,
  onViewSandbox,
  onSelectProvider,
  renderCredentialInput,
}) => {
  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const workspaceQuery = useWorkspace(workspace);
  const sandboxCount = useSandboxes(workspace);
  const templateCount = useTemplates(workspace);
  const providerCount = useProviders(workspace);
  const memberCount = useMembers(workspace);
  const features = useFeatureFlags();
  const services = useWorkspaceServices(workspace, {
    enabled: features.services,
  });
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string | number>('sandboxes');

  // A service endpoint is exposed and deleted on its sandbox's Services tab.
  const viewSandboxServices = (name: string) => {
    if (onViewSandbox) {
      onViewSandbox(name, 'services');
    } else {
      navigate(`/workspaces/${workspace}/sandboxes/${name}?tab=services`);
    }
  };

  if (workspaceQuery.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading workspace" />
        </Bullseye>
      </PageSection>
    );
  }

  // The workspace is re-read while the page is open. Only a first load that
  // failed takes the page: every tab below, and any dialog open in one, lives
  // in this component, and a refresh that did not get through must not throw
  // them away. It is reported above the details instead.
  const refreshFailed = isRefreshError(workspaceQuery);
  if (workspaceQuery.isError && !refreshFailed) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={`Failed to load workspace ${workspace}`}
          actionLinks={
            <Button variant="link" onClick={() => workspaceQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {(workspaceQuery.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  return (
    <>
      <PageSection>
        {refreshFailed && (
          <RefreshErrorAlert
            title={`Workspace ${workspace} could not be refreshed`}
            error={workspaceQuery.error}
            onRetry={() => workspaceQuery.refetch()}
            className="pf-v6-u-mb-md"
            data-testid="workspace-refresh-error"
          />
        )}
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapMd' }}
        >
          <FlexItem>
            <Title headingLevel="h1">{workspace}</Title>
          </FlexItem>
          {workspaceQuery.data && (
            <FlexItem>
              <PhaseLabel phase={workspaceQuery.data.phase} />
            </FlexItem>
          )}
        </Flex>
        {workspaceQuery.data && (
          <DescriptionList
            isHorizontal
            isCompact
            className="pf-v6-u-mt-md"
            data-testid="workspace-details"
          >
            <DescriptionListGroup>
              <DescriptionListTerm>ID</DescriptionListTerm>
              <DescriptionListDescription>
                {workspaceQuery.data.metadata.id || '-'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Resource version</DescriptionListTerm>
              <DescriptionListDescription>
                {workspaceQuery.data.metadata.resourceVersion}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Created</DescriptionListTerm>
              <DescriptionListDescription>
                {formatTimestamp(workspaceQuery.data.metadata.createdAtMs)}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Labels</DescriptionListTerm>
              <DescriptionListDescription>
                <LabelsList labels={workspaceQuery.data.metadata.labels} />
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        )}
      </PageSection>
      <PageSection>
        <Tabs
          activeKey={activeTab}
          onSelect={(_event, key) => setActiveTab(key)}
          aria-label="Workspace resources"
        >
          <Tab
            eventKey="sandboxes"
            title={
              <TabTitleText>
                Sandboxes{' '}
                {sandboxCount.data && (
                  <Badge isRead>{sandboxCount.data.length}</Badge>
                )}
              </TabTitleText>
            }
            data-testid="tab-sandboxes"
          >
            <TabPanel>
              <SandboxListPage
                workspace={workspace}
                onSelect={onSelectSandbox}
                onViewSandbox={onViewSandbox}
              />
            </TabPanel>
          </Tab>
          <Tab
            eventKey="templates"
            title={
              <TabTitleText>
                Templates{' '}
                {templateCount.data && (
                  <Badge isRead>{templateCount.data.length}</Badge>
                )}
              </TabTitleText>
            }
            data-testid="tab-templates"
          >
            <TabPanel>
              <TemplatesTab workspace={workspace} />
            </TabPanel>
          </Tab>
          <Tab
            eventKey="providers"
            title={
              <TabTitleText>
                Providers{' '}
                {providerCount.data && (
                  <Badge isRead>{providerCount.data.length}</Badge>
                )}
              </TabTitleText>
            }
            data-testid="tab-providers"
          >
            <TabPanel>
              <ProviderListPage
                workspace={workspace}
                onSelect={onSelectProvider}
                renderCredentialInput={resolvedCredentialInput}
              />
            </TabPanel>
          </Tab>
          <Tab
            eventKey="members"
            title={
              <TabTitleText>
                Members{' '}
                {memberCount.data && (
                  <Badge isRead>{memberCount.data.length}</Badge>
                )}
              </TabTitleText>
            }
            data-testid="tab-members"
          >
            <TabPanel>
              <MemberListPage workspace={workspace} />
            </TabPanel>
          </Tab>
          {features.services && (
            <Tab
              eventKey="services"
              title={
                <TabTitleText>
                  Services{' '}
                  {services.data && (
                    <Badge isRead>{services.data.length}</Badge>
                  )}
                </TabTitleText>
              }
              data-testid="tab-services"
            >
              <TabPanel>
                <ServiceEndpointsTable
                  query={services}
                  workspace={workspace}
                  onSelectSandbox={(_workspace, name) =>
                    viewSandboxServices(name)
                  }
                />
              </TabPanel>
            </Tab>
          )}
          <Tab
            eventKey="profiles"
            title={<TabTitleText>Profiles</TabTitleText>}
            data-testid="tab-profiles"
          >
            <TabPanel>
              <ProfilesTab workspace={workspace} />
            </TabPanel>
          </Tab>
        </Tabs>
      </PageSection>
    </>
  );
};

export default WorkspaceDetailPage;
