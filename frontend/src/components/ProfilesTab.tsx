import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Label,
  LabelGroup,
  Spinner,
} from '@patternfly/react-core';
import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { useProviderProfiles } from '../api/providers';

type ProfilesTabProps = {
  workspace: string;
};

// Read-only browser of provider type profiles (builtin + platform +
// workspace-scoped). Profile ids are the valid Provider.type slugs; custom
// profile authoring (import/lint/update) stays CLI-only for now.
const ProfilesTab: React.FC<ProfilesTabProps> = ({ workspace }) => {
  const profiles = useProviderProfiles(workspace);
  const [expanded, setExpanded] = useState<string[]>([]);

  if (profiles.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading provider profiles" />
      </Bullseye>
    );
  }

  if (profiles.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load provider profiles"
        actionLinks={
          <Button variant="link" onClick={() => profiles.refetch()}>
            Retry
          </Button>
        }
      >
        {(profiles.error as Error).message}
      </Alert>
    );
  }

  const rows = profiles.data ?? [];

  const toggle = (id: string) => {
    setExpanded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <Table aria-label="Provider profiles" data-testid="profiles-table">
      <Thead>
        <Tr>
          <Th screenReaderText="Expand" />
          <Th>Profile</Th>
          <Th>Category</Th>
          <Th>Source</Th>
          <Th>Inference</Th>
        </Tr>
      </Thead>
      {rows.map((profile, rowIndex) => (
        <Tbody key={profile.id} isExpanded={expanded.includes(profile.id)}>
          <Tr>
            <Td
              expand={{
                rowIndex,
                isExpanded: expanded.includes(profile.id),
                onToggle: () => toggle(profile.id),
              }}
            />
            <Td dataLabel="Profile">
              <strong>{profile.displayName}</strong>{' '}
              <Label isCompact color="grey">
                {profile.id}
              </Label>
            </Td>
            <Td dataLabel="Category">
              <Label isCompact color="purple">
                {profile.category}
              </Label>
            </Td>
            <Td dataLabel="Source">{profile.source || 'builtin'}</Td>
            <Td dataLabel="Inference">
              {profile.inferenceCapable ? 'Yes' : '-'}
            </Td>
          </Tr>
          <Tr isExpanded={expanded.includes(profile.id)}>
            <Td />
            <Td colSpan={4}>
              <ExpandableRowContent>
                {profile.description && <div>{profile.description}</div>}
                <div className="pf-v6-u-mt-sm">
                  <strong>Credentials:</strong>{' '}
                  {profile.credentials.length === 0
                    ? 'none'
                    : profile.credentials
                        .map(
                          (credential) =>
                            `${credential.name}${credential.required ? ' (required)' : ''}`,
                        )
                        .join(', ')}
                </div>
                {(profile.endpoints ?? []).length > 0 && (
                  <div className="pf-v6-u-mt-sm">
                    <strong>Endpoints:</strong>{' '}
                    <LabelGroup numLabels={6}>
                      {(profile.endpoints ?? []).map((endpoint) => (
                        <Label key={endpoint} isCompact color="teal">
                          {endpoint}
                        </Label>
                      ))}
                    </LabelGroup>
                  </div>
                )}
              </ExpandableRowContent>
            </Td>
          </Tr>
        </Tbody>
      ))}
    </Table>
  );
};

export default ProfilesTab;
