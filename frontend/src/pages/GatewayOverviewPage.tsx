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
  Gallery,
  Label,
  LabelGroup,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  QuestionCircleIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useGatewayInfo } from '../api/gateway';
import type { GatewayExtensionKind, ServiceStatus } from '../types';

const statusColor = (
  status: ServiceStatus,
): 'green' | 'orange' | 'red' | 'grey' => {
  switch (status) {
    case 'HEALTHY':
      return 'green';
    case 'DEGRADED':
      return 'orange';
    case 'UNHEALTHY':
      return 'red';
    default:
      return 'grey';
  }
};

const statusIcon = (status: ServiceStatus) => {
  switch (status) {
    case 'HEALTHY':
      return <CheckCircleIcon />;
    case 'DEGRADED':
      return <ExclamationTriangleIcon />;
    case 'UNHEALTHY':
      return <ExclamationCircleIcon />;
    default:
      return <QuestionCircleIcon />;
  }
};

const EXTENSION_KIND_LABELS: Record<GatewayExtensionKind, string> = {
  COMPUTE_DRIVER: 'Compute driver',
  CREDENTIAL_DRIVER: 'Credential driver',
  GATEWAY_INTERCEPTOR: 'Gateway interceptor',
  SUPERVISOR_MIDDLEWARE: 'Supervisor middleware',
  UNSPECIFIED: 'Unspecified',
};

// A kind this build has no name for is shown as the gateway spelled it.
const extensionKindLabel = (kind: string): string =>
  (EXTENSION_KIND_LABELS as Record<string, string | undefined>)[kind] ?? kind;

const CapabilityList: React.FC<{ capabilities?: string[] }> = ({
  capabilities,
}) =>
  capabilities && capabilities.length > 0 ? (
    <LabelGroup numLabels={4}>
      {capabilities.map((capability) => (
        <Label key={capability} color="grey" isCompact>
          {capability}
        </Label>
      ))}
    </LabelGroup>
  ) : (
    <>-</>
  );

// Gateway overview. The API exposes exactly four things about the gateway:
// status, version, the compute driver list and the extensions it negotiated
// with (GetGatewayInfoResponse) — nothing else, so this page is intentionally
// small. It is what `openshell gateway info` prints.
const GatewayOverviewPage: React.FC = () => {
  const gateway = useGatewayInfo();

  if (gateway.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading gateway info" />
        </Bullseye>
      </PageSection>
    );
  }

  if (gateway.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title="Cannot reach the OpenShell gateway"
          actionLinks={
            <Button variant="link" onClick={() => gateway.refetch()}>
              Retry
            </Button>
          }
        >
          {(gateway.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const info = gateway.data;
  // Absent from a BFF that predates the field.
  const extensions = info?.extensions ?? [];
  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Gateway</Title>
      </PageSection>
      <PageSection>
        <Gallery hasGutter minWidths={{ default: '260px' }}>
          <Card data-testid="gateway-status-card">
            <CardTitle>Status</CardTitle>
            <CardBody>
              <Label
                color={statusColor(info?.status ?? 'UNSPECIFIED')}
                icon={statusIcon(info?.status ?? 'UNSPECIFIED')}
              >
                {info?.status ?? 'UNKNOWN'}
              </Label>
            </CardBody>
          </Card>
          <Card data-testid="gateway-version-card">
            <CardTitle>Version</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>Gateway version</DescriptionListTerm>
                  <DescriptionListDescription>
                    {info?.gatewayVersion || '-'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </Gallery>
      </PageSection>
      <PageSection>
        <Card data-testid="gateway-drivers-card">
          <CardTitle>Compute drivers</CardTitle>
          <CardBody>
            <Table aria-label="Compute drivers" variant="compact">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Driver</Th>
                  <Th>Version</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(info?.computeDrivers ?? []).map((driver) => (
                  <Tr key={driver.name}>
                    <Td dataLabel="Name">{driver.name}</Td>
                    <Td dataLabel="Driver">{driver.driverName || '-'}</Td>
                    <Td dataLabel="Version">{driver.driverVersion || '-'}</Td>
                  </Tr>
                ))}
                {(info?.computeDrivers ?? []).length === 0 && (
                  <Tr>
                    <Td colSpan={3}>No compute drivers reported</Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </PageSection>
      <PageSection>
        <Card data-testid="gateway-extensions-card">
          <CardTitle>Extensions</CardTitle>
          <CardBody>
            <Table aria-label="Extensions" variant="compact">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Kind</Th>
                  <Th>Implementation</Th>
                  <Th>Protocol</Th>
                  <Th>Capabilities</Th>
                  <Th>Requires from gateway</Th>
                </Tr>
              </Thead>
              <Tbody>
                {extensions.map((extension) => (
                  <Tr key={`${extension.kind}/${extension.configuredName}`}>
                    <Td dataLabel="Name">{extension.configuredName || '-'}</Td>
                    <Td dataLabel="Kind">
                      {extensionKindLabel(extension.kind)}
                    </Td>
                    <Td dataLabel="Implementation">
                      {[
                        extension.implementationName,
                        extension.implementationVersion,
                      ]
                        .filter(Boolean)
                        .join(' ') || '-'}
                    </Td>
                    <Td dataLabel="Protocol">
                      {extension.protocolMajor}.{extension.protocolMinor}
                    </Td>
                    <Td dataLabel="Capabilities">
                      <CapabilityList
                        capabilities={extension.supportedCapabilities}
                      />
                    </Td>
                    <Td dataLabel="Requires from gateway">
                      <CapabilityList
                        capabilities={extension.requiredCapabilities}
                      />
                    </Td>
                  </Tr>
                ))}
                {extensions.length === 0 && (
                  <Tr>
                    <Td colSpan={6}>No extensions reported</Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
};

export default GatewayOverviewPage;
