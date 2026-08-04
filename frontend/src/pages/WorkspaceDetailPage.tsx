import { useState } from 'react';
import {
  Alert,
  Badge,
  Bullseye,
  Button,
  Flex,
  FlexItem,
  PageSection,
  Spinner,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';

import { useProviders } from '../api/providers';
import { useSandboxes } from '../api/sandboxes';
import { useMembers, useWorkspace } from '../api/workspaces';
import InferenceTab from '../components/InferenceTab';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import ProfilesTab from '../components/provider/ProfilesTab';
import { useSlots } from '../slots';
import MemberListPage from './MemberListPage';
import ProviderListPage from './ProviderListPage';
import SandboxListPage from './SandboxListPage';
import type { CredentialInputSlot, ModelPickerSlot } from '../types';

type WorkspaceDetailPageProps = {
  workspace: string;
  onSelectSandbox?: (name: string) => void;
  onSelectProvider?: (name: string) => void;
  renderCredentialInput?: CredentialInputSlot;
  renderModelPicker?: ModelPickerSlot;
};

const TabPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pf-v6-u-pt-lg">{children}</div>
);

const WorkspaceDetailPage: React.FC<WorkspaceDetailPageProps> = ({
  workspace,
  onSelectSandbox,
  onSelectProvider,
  renderCredentialInput,
  renderModelPicker,
}) => {
  const slots = useSlots();
  const resolvedCredentialInput =
    renderCredentialInput ?? slots.credentialInput;
  const resolvedModelPicker = renderModelPicker ?? slots.modelPicker;
  const workspaceQuery = useWorkspace(workspace);
  const sandboxCount = useSandboxes(workspace);
  const providerCount = useProviders(workspace);
  const memberCount = useMembers(workspace);
  const [activeTab, setActiveTab] = useState<string | number>('sandboxes');

  if (workspaceQuery.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading workspace" />
        </Bullseye>
      </PageSection>
    );
  }

  if (workspaceQuery.isError) {
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
        {workspaceQuery.data &&
          Object.keys(workspaceQuery.data.metadata.labels ?? {}).length > 0 && (
            <LabelsList labels={workspaceQuery.data.metadata.labels} />
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
              />
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
          <Tab
            eventKey="inference"
            title={<TabTitleText>Inference</TabTitleText>}
            data-testid="tab-inference"
          >
            <TabPanel>
              <InferenceTab
                workspace={workspace}
                renderModelPicker={resolvedModelPicker}
              />
            </TabPanel>
          </Tab>
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
