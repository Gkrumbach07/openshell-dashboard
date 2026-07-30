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
import type { ServiceStatus } from '../types';

const statusColor = (status: ServiceStatus): 'green' | 'orange' | 'red' | 'grey' => {
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

// Gateway overview. The API exposes exactly three things about the gateway:
// status, version, and the compute driver list (GetGatewayInfoResponse) —
// nothing else, so this page is intentionally small.
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
          actionLinks={<Button variant="link" onClick={() => gateway.refetch()}>Retry</Button>}
        >
          {(gateway.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const info = gateway.data;
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
              <Label color={statusColor(info?.status ?? 'UNSPECIFIED')} icon={statusIcon(info?.status ?? 'UNSPECIFIED')}>
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
    </>
  );
};

export default GatewayOverviewPage;
