import { Label } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import type { ProfileDiagnostic } from '../../types';

type ProfileDiagnosticsProps = {
  diagnostics: ProfileDiagnostic[];
};

// Whether a diagnostic stops a profile from being written. The gateway
// writes nothing while it has an error to report; a warning it reports and
// goes on.
export const isProfileError = (diagnostic: ProfileDiagnostic): boolean =>
  diagnostic.severity === 'error';

// What was found in provider profiles, by the dashboard reading the files and
// by the gateway checking the profiles: which file and profile, which field,
// and what is wrong with it.
const ProfileDiagnostics: React.FC<ProfileDiagnosticsProps> = ({
  diagnostics,
}) => (
  <Table
    aria-label="Profile diagnostics"
    variant="compact"
    data-testid="profile-diagnostics"
  >
    <Thead>
      <Tr>
        <Th>Severity</Th>
        <Th>File</Th>
        <Th>Profile</Th>
        <Th>Field</Th>
        <Th>Message</Th>
      </Tr>
    </Thead>
    <Tbody>
      {diagnostics.map((diagnostic, index) => (
        <Tr key={index}>
          <Td dataLabel="Severity">
            <Label
              isCompact
              status={isProfileError(diagnostic) ? 'danger' : 'warning'}
            >
              {diagnostic.severity || 'warning'}
            </Label>
          </Td>
          <Td dataLabel="File">{diagnostic.source || '-'}</Td>
          <Td dataLabel="Profile">{diagnostic.profileId || '-'}</Td>
          <Td dataLabel="Field">{diagnostic.field || '-'}</Td>
          <Td dataLabel="Message">{diagnostic.message}</Td>
        </Tr>
      ))}
    </Tbody>
  </Table>
);

export default ProfileDiagnostics;
