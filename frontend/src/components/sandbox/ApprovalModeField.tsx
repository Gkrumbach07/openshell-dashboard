import {
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
} from '@patternfly/react-core';

import { useFeatureFlags } from '../../api/auth';
import { useWorkspaceRole } from '../../api/rbac';
import type { ApprovalMode } from '../../api/sandboxSettings';

type ApprovalModeFieldProps = {
  workspace: string;
  id: string;
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
};

// The approval mode for policy proposals an agent makes from inside the
// sandbox (`openshell sandbox create --approval-mode`).
//
// It is stored as a sandbox setting, which the gateway lets only a workspace
// admin write, so the field is offered to nobody else, and not at all where
// the settings feature is turned off. Without the field the mode stays manual,
// the gateway's default.
const ApprovalModeField: React.FC<ApprovalModeFieldProps> = ({
  workspace,
  id,
  value,
  onChange,
}) => {
  const features = useFeatureFlags();
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);

  if (!features.settings || !isWorkspaceAdmin) {
    return null;
  }

  return (
    <FormGroup label="Proposal approval" fieldId={id}>
      <FormSelect
        id={id}
        data-testid={id}
        value={value}
        onChange={(_event, next) => onChange(next as ApprovalMode)}
      >
        <FormSelectOption value="manual" label="Manual (default)" />
        <FormSelectOption value="auto" label="Auto" />
      </FormSelect>
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            {value === 'auto'
              ? 'Policy proposals the prover raises no findings on are approved automatically; proposals with findings still wait for review. Written as the proposal_approval_mode setting of the sandbox once it is created.'
              : 'Every policy proposal an agent makes waits for review, whatever the prover finds.'}
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  );
};

export default ApprovalModeField;
