import {
  Card,
  CardBody,
  CardTitle,
  Content,
  Label,
  LabelGroup,
  Stack,
  StackItem,
} from '@patternfly/react-core';

import type { ProviderProfile } from '../../types';

type ProviderDiscoveryCardProps = {
  // The profile the provider's type resolves to, if any.
  profile?: ProviderProfile;
};

// The credentials a profile marks for local discovery: the ones the OpenShell
// CLI looks for in the environment it runs in for `provider create
// --from-existing`. The dashboard has no such environment; it shows the list.
const ProviderDiscoveryCard: React.FC<ProviderDiscoveryCardProps> = ({
  profile,
}) => {
  const credentials = profile?.discovery?.credentials ?? [];
  return (
    <Card data-testid="provider-discovery-card">
      <CardTitle>Discovery</CardTitle>
      <CardBody>
        {credentials.length === 0 ? (
          'None'
        ) : (
          <Stack hasGutter>
            <StackItem>
              <Content component="small">
                The credentials the OpenShell CLI can pick up from the
                environment it runs in, with provider create --from-existing.
              </Content>
            </StackItem>
            <StackItem>
              <LabelGroup numLabels={8}>
                {credentials.map((credential) => (
                  <Label key={credential} isCompact color="grey">
                    {credential}
                  </Label>
                ))}
              </LabelGroup>
            </StackItem>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
};

export default ProviderDiscoveryCard;
