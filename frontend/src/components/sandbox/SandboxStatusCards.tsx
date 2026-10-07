import {
  Card,
  CardBody,
  CardTitle,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  StackItem,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import type {
  ConfigurationAdmissionState,
  EndpointResult,
  Sandbox,
} from '../../types';

type SandboxStatusCardsProps = {
  sandbox: Sandbox;
};

const ADMISSION_LABELS: Record<
  ConfigurationAdmissionState,
  { text: string; color: 'green' | 'blue' | 'red' | 'grey' }
> = {
  ACCEPTED: { text: 'Accepted', color: 'green' },
  PENDING: { text: 'Pending', color: 'blue' },
  REJECTED: { text: 'Rejected', color: 'red' },
  UNSPECIFIED: { text: 'Not reported', color: 'grey' },
};

// What each result means, in the words `openshell sandbox get` uses.
const ENDPOINT_RESULTS: Record<EndpointResult, string> = {
  UNSPECIFIED: 'No result provided.',
  NO_OBSERVED_EXCHANGE: 'No exchange observed.',
  HTTP_RESPONSE_RECEIVED: 'Server returned an HTTP response below 400.',
  POLICY_DENIED: 'Blocked by OpenShell policy.',
  CREDENTIAL_UNAVAILABLE:
    'Required OpenShell-managed credential was unavailable.',
  TLS_FAILED: 'TLS connection failed.',
  TRANSPORT_FAILED: 'Connection failed before an HTTP response arrived.',
  UPSTREAM_REJECTED: 'Server rejected the request (HTTP 400 or higher).',
};

// The parts of a sandbox's status that are reported only for some sandboxes,
// each as a card of the Details tab and neither when there is nothing to show:
// whether the sandbox accepted the configuration the gateway wants it to run,
// and the last network result for each tool server its policy configures.
const SandboxStatusCards: React.FC<SandboxStatusCardsProps> = ({ sandbox }) => {
  const admission = sandbox.status.configurationAdmission;
  const endpoints = sandbox.status.endpointStatuses ?? [];
  // A state this build does not know is shown as the gateway sent it.
  const admissionLabel = admission
    ? (ADMISSION_LABELS[admission.state] ?? {
        text: admission.state,
        color: 'grey' as const,
      })
    : undefined;

  return (
    <>
      {admission && admissionLabel && (
        <StackItem>
          <Card data-testid="sandbox-admission-card">
            <CardTitle>Configuration</CardTitle>
            <CardBody>
              <DescriptionList isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>State</DescriptionListTerm>
                  <DescriptionListDescription>
                    <Label
                      color={admissionLabel.color}
                      data-testid="sandbox-admission-state"
                    >
                      {admissionLabel.text}
                    </Label>
                  </DescriptionListDescription>
                </DescriptionListGroup>
                {admission.error && (
                  <DescriptionListGroup>
                    <DescriptionListTerm>Error</DescriptionListTerm>
                    <DescriptionListDescription data-testid="sandbox-admission-error">
                      {admission.error}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                )}
                <DescriptionListGroup>
                  <DescriptionListTerm>Policy version</DescriptionListTerm>
                  <DescriptionListDescription>
                    {admission.policyVersion || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Policy hash</DescriptionListTerm>
                  <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                    {admission.policyHash || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Config revision</DescriptionListTerm>
                  <DescriptionListDescription
                    className="pf-v6-u-font-family-monospace"
                    data-testid="sandbox-admission-config-revision"
                  >
                    {admission.configRevision}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>
                    Provider environment revision
                  </DescriptionListTerm>
                  <DescriptionListDescription className="pf-v6-u-font-family-monospace">
                    {admission.providerEnvRevision}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </StackItem>
      )}
      {endpoints.length > 0 && (
        <StackItem>
          <Card data-testid="sandbox-endpoints-card">
            <CardTitle>Tool server connections</CardTitle>
            <CardBody>
              <Table aria-label="Tool server connections" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Host</Th>
                    <Th>Ports</Th>
                    <Th>Path</Th>
                    <Th>Last result</Th>
                    <Th>Reported at</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {endpoints.map((endpoint) => (
                    <Tr key={endpoint.endpointId}>
                      <Td dataLabel="Host">{endpoint.host}</Td>
                      <Td dataLabel="Ports">
                        {(endpoint.ports ?? []).join(', ') || '-'}
                      </Td>
                      <Td dataLabel="Path">{endpoint.path || '-'}</Td>
                      <Td dataLabel="Last result">
                        {ENDPOINT_RESULTS[endpoint.lastResult] ??
                          endpoint.lastResult}
                      </Td>
                      <Td dataLabel="Reported at">
                        {endpoint.lastReportedAt || 'No report yet'}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <Content component="small">
                Results come from observed MCP over HTTP traffic, and the time
                is when the gateway accepted the report. They do not check
                current availability or tool-call success.
              </Content>
            </CardBody>
          </Card>
        </StackItem>
      )}
    </>
  );
};

export default SandboxStatusCards;
