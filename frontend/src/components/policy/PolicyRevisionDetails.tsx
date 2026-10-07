import React from 'react';
import {
  Alert,
  Bullseye,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';

import { formatTimestamp } from '../../utils/formatters';
import type { PolicyRevision } from '../../types';
import PolicyPayload from './PolicyPayload';

type PolicyRevisionDetailsProps = {
  revision: PolicyRevision;
  // The payload is being fetched, or could not be.
  isLoading?: boolean;
  error?: string;
};

// Everything one revision carries (`openshell policy get --rev N --full`): the
// full hash, when it was loaded, why it failed to if it did, who made it, and
// the policy itself, as the gateway's JSON or as the YAML that command prints.
const PolicyRevisionDetails: React.FC<PolicyRevisionDetailsProps> = ({
  revision,
  isLoading = false,
  error,
}) => {
  const provenance = Object.entries(revision.provenance ?? {}).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  return (
    <Stack hasGutter data-testid={`policy-revision-${revision.version}`}>
      {revision.loadError && (
        <StackItem>
          <Alert
            variant="danger"
            isInline
            title={`Revision ${revision.version} failed to load`}
          >
            {revision.loadError}
          </Alert>
        </StackItem>
      )}
      <StackItem>
        <DescriptionList isCompact isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Hash</DescriptionListTerm>
            <DescriptionListDescription className="pf-v6-u-font-family-monospace">
              {revision.policyHash || '-'}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Created</DescriptionListTerm>
            <DescriptionListDescription>
              {formatTimestamp(revision.createdAtMs)}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Loaded</DescriptionListTerm>
            <DescriptionListDescription>
              {formatTimestamp(revision.loadedAtMs)}
            </DescriptionListDescription>
          </DescriptionListGroup>
          {provenance.map(([key, value]) => (
            <DescriptionListGroup key={key}>
              <DescriptionListTerm>{key}</DescriptionListTerm>
              <DescriptionListDescription>{value}</DescriptionListDescription>
            </DescriptionListGroup>
          ))}
        </DescriptionList>
      </StackItem>
      <StackItem>
        {isLoading && (
          <Bullseye>
            <Spinner size="md" aria-label="Loading the revision's policy" />
          </Bullseye>
        )}
        {!isLoading && error && (
          <Alert
            variant="warning"
            isInline
            title="This revision's policy could not be read"
          >
            {error}
          </Alert>
        )}
        {!isLoading && !error && revision.policy && (
          <PolicyPayload
            policy={revision.policy}
            fileName={`policy-revision-${revision.version}`}
            data-testid={`policy-revision-${revision.version}-payload`}
          />
        )}
        {!isLoading && !error && !revision.policy && (
          <Content component="small">
            Policy payload not available for this revision.
          </Content>
        )}
      </StackItem>
    </Stack>
  );
};

export default PolicyRevisionDetails;
