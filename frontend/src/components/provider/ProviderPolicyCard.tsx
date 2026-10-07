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
  LabelGroup,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import type { ProviderProfile } from '../../types';
import {
  endpointAccess,
  endpointAddress,
  endpointProtocol,
} from '../../utils/providerSummary';

type ProviderPolicyCardProps = {
  // The profile the provider's type resolves to, if any.
  profile?: ProviderProfile;
};

// The network policy a provider's profile carries: its endpoints, each with
// its protocol, the access it allows and the path it is limited to, and the
// binaries that may reach them. It is the profile's, so a provider without a
// profile has none to show.
const ProviderPolicyCard: React.FC<ProviderPolicyCardProps> = ({ profile }) => {
  const binaries = profile?.binaries ?? [];
  const summaries = profile?.endpoints ?? [];

  const endpoints = () => {
    if (!profile) {
      return 'No provider profile found, so there is no policy metadata for this provider.';
    }
    // The endpoints whole, or, from a backend that cannot read them whole,
    // only where each one points.
    if (profile.networkEndpoints === undefined) {
      return summaries.length === 0 ? (
        'No profile endpoints.'
      ) : (
        <LabelGroup numLabels={8}>
          {summaries.map((endpoint, index) => (
            <Label key={index} isCompact color="teal">
              {endpoint}
            </Label>
          ))}
        </LabelGroup>
      );
    }
    if (profile.networkEndpoints.length === 0) {
      return 'No profile endpoints.';
    }
    return (
      <Table aria-label="Profile endpoints" variant="compact">
        <Thead>
          <Tr>
            <Th>Endpoint</Th>
            <Th>Protocol</Th>
            <Th>Access</Th>
            <Th>Path</Th>
          </Tr>
        </Thead>
        <Tbody>
          {profile.networkEndpoints.map((endpoint, index) => (
            <Tr key={index}>
              <Td dataLabel="Endpoint">{endpointAddress(endpoint)}</Td>
              <Td dataLabel="Protocol">{endpointProtocol(endpoint)}</Td>
              <Td dataLabel="Access">{endpointAccess(endpoint)}</Td>
              <Td dataLabel="Path">{endpoint.path || '-'}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  };

  return (
    <Card data-testid="provider-policy-card">
      <CardTitle>Policy</CardTitle>
      <CardBody>
        <Stack hasGutter>
          {profile && (
            <StackItem>
              <Content component="small">
                The endpoints the provider profile declares, and the binaries
                that may reach them.
              </Content>
            </StackItem>
          )}
          <StackItem>{endpoints()}</StackItem>
          {binaries.length > 0 && (
            <StackItem>
              <DescriptionList isCompact isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>Binaries</DescriptionListTerm>
                  <DescriptionListDescription>
                    <LabelGroup numLabels={8}>
                      {binaries.map((binary) => (
                        <Label key={binary.path} isCompact color="grey">
                          {binary.path}
                        </Label>
                      ))}
                    </LabelGroup>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
};

export default ProviderPolicyCard;
