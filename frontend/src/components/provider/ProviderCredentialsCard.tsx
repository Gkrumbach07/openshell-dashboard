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
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import type { Provider, ProviderProfile } from '../../types';
import { formatTimestamp } from '../../utils/formatters';
import {
  allowsRuntimeProviderCredentials,
  isRuntimeResolvable,
} from '../../utils/providerProfiles';
import {
  type CredentialRow,
  credentialRows,
} from '../../utils/providerSummary';

type ProviderCredentialsCardProps = {
  provider: Provider;
  // The profile the provider's type resolves to. Without one the card lists
  // the keys the provider holds, which is all there is to say.
  profile?: ProviderProfile;
};

const SecretLabel: React.FC = () => (
  <Label isCompact color="grey">
    secret — write-only
  </Label>
);

// A provider's credentials as its profile declares them: each credential the
// profile names, whether it is required, the keys it may be stored under,
// whether the provider holds it and when it expires. Credential VALUES are
// secret and never leave the gateway: only keys and expiry times are shown.
const ProviderCredentialsCard: React.FC<ProviderCredentialsCardProps> = ({
  provider,
  profile,
}) => {
  const storedKeys = provider.credentialNames ?? [];
  const expiries = provider.credentialExpiresAtMs ?? {};
  const rows = credentialRows(profile, storedKeys);

  // When a credential is held under one key its expiry stands alone; held
  // under several, each expiry says which key it is for.
  const expiryOf = (row: CredentialRow): string => {
    if (row.heldKeys.length === 0) {
      return '-';
    }
    const when = (key: string) =>
      expiries[key] ? formatTimestamp(expiries[key]) : 'Never';
    return row.heldKeys.length === 1
      ? when(row.heldKeys[0])
      : row.heldKeys.map((key) => `${key}: ${when(key)}`).join(', ');
  };

  const status = (row: CredentialRow) => {
    if (row.heldKeys.length > 0) {
      return (
        <>
          <Label isCompact status="success">
            Present
          </Label>
          {row.keys.length > 1 && ` as ${row.heldKeys.join(', ')}`}
        </>
      );
    }
    const atRuntime =
      !!profile &&
      !!row.credential &&
      isRuntimeResolvable(profile, row.credential);
    return (
      <LabelGroup>
        {row.credential?.required && !atRuntime ? (
          <Label isCompact status="warning">
            Missing
          </Label>
        ) : (
          <Label isCompact color="grey">
            Missing
          </Label>
        )}
        {atRuntime && (
          <Label isCompact color="blue">
            resolved at runtime
          </Label>
        )}
      </LabelGroup>
    );
  };

  return (
    <Card data-testid="provider-credentials-card">
      <CardTitle>Credentials</CardTitle>
      <CardBody>
        <Stack hasGutter>
          {storedKeys.length === 0 && (
            <StackItem>
              <Content component="p">
                {profile && allowsRuntimeProviderCredentials(profile)
                  ? 'No credentials stored. This provider type resolves its credentials at runtime: through a token grant, or by the gateway once refresh is configured.'
                  : 'No credentials set'}
              </Content>
            </StackItem>
          )}
          {rows.length > 0 && (
            <StackItem>
              {profile ? (
                <Table aria-label="Provider credentials" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Credential</Th>
                      <Th modifier="nowrap">Requirement</Th>
                      <Th>Env vars</Th>
                      <Th>Status</Th>
                      <Th>Value</Th>
                      <Th>Expires</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr
                        key={row.name}
                        data-testid={`provider-credential-${row.name}`}
                      >
                        <Td dataLabel="Credential">{row.name}</Td>
                        <Td dataLabel="Requirement">
                          {row.credential ? (
                            row.credential.required ? (
                              'required'
                            ) : (
                              'optional'
                            )
                          ) : (
                            <Label isCompact status="warning">
                              not declared by the profile
                            </Label>
                          )}
                        </Td>
                        <Td dataLabel="Env vars">
                          {(row.credential?.envVars ?? []).length > 0 ? (
                            <LabelGroup numLabels={4}>
                              {(row.credential?.envVars ?? []).map((key) => (
                                <Label key={key} isCompact color="grey">
                                  {key}
                                </Label>
                              ))}
                            </LabelGroup>
                          ) : (
                            '-'
                          )}
                        </Td>
                        <Td dataLabel="Status">{status(row)}</Td>
                        <Td dataLabel="Value">
                          {row.heldKeys.length > 0 ? <SecretLabel /> : '-'}
                        </Td>
                        <Td dataLabel="Expires">{expiryOf(row)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : (
                <Table aria-label="Provider credentials" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Key</Th>
                      <Th>Value</Th>
                      <Th>Expires</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr
                        key={row.name}
                        data-testid={`provider-credential-${row.name}`}
                      >
                        <Td dataLabel="Key">{row.name}</Td>
                        <Td dataLabel="Value">
                          <SecretLabel />
                        </Td>
                        <Td dataLabel="Expires">{expiryOf(row)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
};

export default ProviderCredentialsCard;
