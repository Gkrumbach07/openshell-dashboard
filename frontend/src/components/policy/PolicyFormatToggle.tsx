import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';

import type { PolicyFileFormat } from '../../utils/policyFile';

// What each of the two formats is, for wherever one is chosen. YAML is the
// one the CLI reads; the JSON is the gateway's own and the CLI does not.
export const POLICY_FORMAT_NOTE: Record<PolicyFileFormat, string> = {
  yaml: 'YAML is the policy file format: what `openshell policy get --full` prints, and what `openshell sandbox create --policy` and `openshell policy set --policy` read.',
  json: "JSON is the policy as the gateway's API holds it, under its own field names (protojson). The CLI does not read this form; switch to YAML for a file it does.",
};

type PolicyFormatToggleProps = {
  format: PolicyFileFormat;
  onChange: (format: PolicyFileFormat) => void;
  // A format the document cannot be shown in right now.
  disabledFormat?: PolicyFileFormat;
  // Leads the test id of each choice: `<id>-yaml` and `<id>-json`.
  'data-testid'?: string;
};

// The choice between the two forms a policy is shown and edited in.
const PolicyFormatToggle: React.FC<PolicyFormatToggleProps> = ({
  format,
  onChange,
  disabledFormat,
  'data-testid': testId = 'policy-format',
}) => (
  <ToggleGroup aria-label="Policy format">
    {(['yaml', 'json'] as const).map((choice) => (
      <ToggleGroupItem
        key={choice}
        text={choice.toUpperCase()}
        isSelected={format === choice}
        isDisabled={disabledFormat === choice}
        onChange={() => {
          if (format !== choice) {
            onChange(choice);
          }
        }}
        data-testid={`${testId}-${choice}`}
      />
    ))}
  </ToggleGroup>
);

export default PolicyFormatToggle;
