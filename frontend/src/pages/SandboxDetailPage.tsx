import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Tab,
  TabTitleText,
  Tabs,
  Title,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useFeatureFlags } from '../api/auth';
import { useSandbox } from '../api/sandboxes';
import ConnectCard from '../components/ConnectCard';
import LabelsList from '../components/LabelsList';
import PhaseLabel from '../components/PhaseLabel';
import SandboxDraftsTab from '../components/SandboxDraftsTab';
import SandboxFilesTab from '../components/SandboxFilesTab';
import SandboxLogsTab from '../components/SandboxLogsTab';
import SandboxTerminalTab from '../components/SandboxTerminalTab';
import PolicyRuleEditor from '../components/PolicyRuleEditor';
import SandboxProvidersTab from '../components/SandboxProvidersTab';
import SandboxServicesTab from '../components/SandboxServicesTab';
import { formatTimestamp } from '../components/utils';

type SandboxDetailPageProps = {
  workspace: string;
  sandboxName: string;
};

const SandboxDetailPage: React.FC<SandboxDetailPageProps> = ({ workspace, sandboxName }) => {
  const sandbox = useSandbox(workspace, sandboxName);
  const features = useFeatureFlags();
  const [activeTab, setActiveTab] = useState<string | number>('details');

  if (sandbox.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading sandbox" />
        </Bullseye>
      </PageSection>
    );
  }

  if (sandbox.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={`Failed to load sandbox ${sandboxName}`}
          actionLinks={<Button variant="link" onClick={() => sandbox.refetch()}>Retry</Button>}
        >
          {(sandbox.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const data = sandbox.data;
  if (!data) {
    return null;
  }

  return (
    <>
      <PageSection>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <Title headingLevel="h1">{data.metadata.name}</Title>
          </FlexItem>
          <FlexItem>
            <PhaseLabel phase={data.status.phase} />
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection>
        <Tabs
          activeKey={activeTab}
          onSelect={(_event, key) => setActiveTab(key)}
          aria-label="Sandbox detail"
        >
          <Tab eventKey="details" title={<TabTitleText>Details</TabTitleText>} data-testid="tab-details">
            <Stack hasGutter className="pf-v6-u-pt-lg">
              <StackItem>
                <Card data-testid="sandbox-details-card">
                  <CardTitle>Details</CardTitle>
                  <CardBody>
                    <DescriptionList isHorizontal>
                      <DescriptionListGroup>
                        <DescriptionListTerm>ID</DescriptionListTerm>
                        <DescriptionListDescription>{data.metadata.id}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Workspace</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.metadata.workspace || workspace}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Image</DescriptionListTerm>
                        <DescriptionListDescription>{data.spec.image || '-'}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Created</DescriptionListTerm>
                        <DescriptionListDescription>
                          {formatTimestamp(data.metadata.createdAtMs)}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Active policy version</DescriptionListTerm>
                        <DescriptionListDescription>
                          {data.status.currentPolicyVersion || '-'}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Attached providers</DescriptionListTerm>
                        <DescriptionListDescription>
                          {(data.spec.providers ?? []).length > 0 ? (
                            <LabelGroup>
                              {(data.spec.providers ?? []).map((provider) => (
                                <Label key={provider} color="blue">
                                  {provider}
                                </Label>
                              ))}
                            </LabelGroup>
                          ) : (
                            'None'
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Labels</DescriptionListTerm>
                        <DescriptionListDescription>
                          <LabelsList labels={data.metadata.labels} />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              </StackItem>
              <StackItem>
                <Card data-testid="sandbox-conditions-card">
                  <CardTitle>Conditions</CardTitle>
                  <CardBody>
                    <Table aria-label="Sandbox conditions" variant="compact">
                      <Thead>
                        <Tr>
                          <Th>Type</Th>
                          <Th>Status</Th>
                          <Th>Reason</Th>
                          <Th>Message</Th>
                          <Th>Last transition</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {(data.status.conditions ?? []).map((condition) => (
                          <Tr key={condition.type}>
                            <Td dataLabel="Type">{condition.type}</Td>
                            <Td dataLabel="Status">{condition.status}</Td>
                            <Td dataLabel="Reason">{condition.reason || '-'}</Td>
                            <Td dataLabel="Message">{condition.message || '-'}</Td>
                            <Td dataLabel="Last transition">{condition.lastTransitionTime || '-'}</Td>
                          </Tr>
                        ))}
                        {(data.status.conditions ?? []).length === 0 && (
                          <Tr>
                            <Td colSpan={5}>No conditions reported</Td>
                          </Tr>
                        )}
                      </Tbody>
                    </Table>
                  </CardBody>
                </Card>
              </StackItem>
              <StackItem>
                <ConnectCard sandboxName={data.metadata.name} />
              </StackItem>
            </Stack>
          </Tab>
          <Tab eventKey="logs" title={<TabTitleText>Logs</TabTitleText>} data-testid="tab-logs">
            <div className="pf-v6-u-pt-lg">
              <SandboxLogsTab workspace={workspace} sandboxName={sandboxName} />
            </div>
          </Tab>
          {features.terminal && (
            <Tab eventKey="terminal" title={<TabTitleText>Terminal</TabTitleText>} data-testid="tab-terminal">
              <div className="pf-v6-u-pt-lg">
                <SandboxTerminalTab workspace={workspace} sandboxName={sandboxName} />
              </div>
            </Tab>
          )}
          <Tab eventKey="providers" title={<TabTitleText>Providers</TabTitleText>} data-testid="tab-sandbox-providers">
            <div className="pf-v6-u-pt-lg">
              <SandboxProvidersTab workspace={workspace} sandboxName={sandboxName} />
            </div>
          </Tab>
          <Tab eventKey="policy" title={<TabTitleText>Policy</TabTitleText>} data-testid="tab-policy">
            <div className="pf-v6-u-pt-lg">
              <PolicyRuleEditor workspace={workspace} sandboxName={sandboxName} />
            </div>
          </Tab>
          {features.draftPolicy && (
            <Tab eventKey="proposals" title={<TabTitleText>Proposals</TabTitleText>} data-testid="tab-proposals">
              <div className="pf-v6-u-pt-lg">
                <SandboxDraftsTab workspace={workspace} sandboxName={sandboxName} />
              </div>
            </Tab>
          )}
          {features.services && (
            <Tab eventKey="services" title={<TabTitleText>Services</TabTitleText>} data-testid="tab-services">
              <div className="pf-v6-u-pt-lg">
                <SandboxServicesTab workspace={workspace} sandboxName={sandboxName} />
              </div>
            </Tab>
          )}
          {features.fileTransfer && (
            <Tab eventKey="files" title={<TabTitleText>Files</TabTitleText>} data-testid="tab-files">
              <div className="pf-v6-u-pt-lg">
                <SandboxFilesTab workspace={workspace} sandboxName={sandboxName} />
              </div>
            </Tab>
          )}
        </Tabs>
      </PageSection>
    </>
  );
};

export default SandboxDetailPage;
