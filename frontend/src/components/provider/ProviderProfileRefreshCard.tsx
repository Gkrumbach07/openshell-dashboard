import { Card, CardBody, CardTitle, Label } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import type { ProviderProfile } from '../../types';
import {
  materialKeysLabel,
  profileRefreshSummaries,
} from '../../utils/providerSummary';

type ProviderProfileRefreshCardProps = {
  // The profile the provider's type resolves to, if any.
  profile?: ProviderProfile;
};

// The refresh a provider's profile declares for each of its credentials: the
// strategy, the scopes it asks for and how many inputs it takes. This is what
// the profile says can be configured; what is configured on the provider, and
// how it is going, is the credential refresh card.
const ProviderProfileRefreshCard: React.FC<ProviderProfileRefreshCardProps> = ({
  profile,
}) => {
  const summaries = profile ? profileRefreshSummaries(profile) : [];

  const body = () => {
    if (!profile) {
      return 'No profile refresh metadata.';
    }
    if (summaries.length === 0) {
      return 'No refresh metadata in profile.';
    }
    return (
      <Table aria-label="Refresh declared by the profile" variant="compact">
        <Thead>
          <Tr>
            <Th>Credential</Th>
            <Th>Strategy</Th>
            <Th>Scopes</Th>
            <Th>Material</Th>
          </Tr>
        </Thead>
        <Tbody>
          {summaries.map((summary) => (
            <Tr key={summary.credential}>
              <Td dataLabel="Credential">{summary.credential}</Td>
              <Td dataLabel="Strategy">
                <Label isCompact color="blue">
                  {summary.strategy}
                </Label>
              </Td>
              <Td dataLabel="Scopes">{summary.scopes.join(', ') || '-'}</Td>
              <Td dataLabel="Material">
                {materialKeysLabel(summary.materialKeys)}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  };

  return (
    <Card data-testid="provider-profile-refresh-card">
      <CardTitle>Refresh declared by the profile</CardTitle>
      <CardBody>{body()}</CardBody>
    </Card>
  );
};

export default ProviderProfileRefreshCard;
