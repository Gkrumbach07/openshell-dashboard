import { Alert } from '@patternfly/react-core';

import {
  PROPOSAL_APPROVAL_MODE_KEY,
  type ApprovalModeFailure,
} from '../../api/sandboxSettings';

type ApprovalModeFailureAlertProps = {
  failure: ApprovalModeFailure;
};

// Shown in place of a create form when the sandbox was created and its
// approval mode could not be set. The sandbox is not rolled back: it exists
// without a mode of its own, as it does after `openshell sandbox create
// --approval-mode auto` fails at the same step.
const ApprovalModeFailureAlert: React.FC<ApprovalModeFailureAlertProps> = ({
  failure,
}) => (
  <Alert
    variant="warning"
    isInline
    title={`Sandbox "${failure.sandboxName}" was created, but its approval mode was not set`}
    data-testid="approval-mode-failure"
  >
    <p>
      Setting the approval mode to {failure.mode} failed: {failure.message}
    </p>
    <p>
      The sandbox has no approval mode of its own, so the gateway setting
      applies: manual, unless one is set globally. To try again, set{' '}
      <code>{PROPOSAL_APPROVAL_MODE_KEY}</code> to <code>{failure.mode}</code>{' '}
      on the Settings tab of the sandbox.
    </p>
  </Alert>
);

export default ApprovalModeFailureAlert;
