import { Label } from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon, InProgressIcon } from '@patternfly/react-icons';

import type { SandboxPhase, WorkspacePhase } from '../types';

type PhaseLabelProps = {
  phase: SandboxPhase | WorkspacePhase;
};

// Renders a sandbox or workspace lifecycle phase. Sandbox phases come from
// the SandboxPhase enum: PROVISIONING → READY | ERROR → DELETING. There is no
// stopped/suspended state in the OpenShell API.
const PhaseLabel: React.FC<PhaseLabelProps> = ({ phase }) => {
  switch (phase) {
    case 'READY':
    case 'ACTIVE':
      return (
        <Label color="green" icon={<CheckCircleIcon />} data-testid="phase-label">
          {phase}
        </Label>
      );
    case 'ERROR':
      return (
        <Label color="red" icon={<ExclamationCircleIcon />} data-testid="phase-label">
          {phase}
        </Label>
      );
    case 'PROVISIONING':
      return (
        <Label color="blue" icon={<InProgressIcon />} data-testid="phase-label">
          {phase}
        </Label>
      );
    case 'DELETING':
    case 'TERMINATING':
      return (
        <Label color="orange" icon={<InProgressIcon />} data-testid="phase-label">
          {phase}
        </Label>
      );
    default:
      return (
        <Label color="grey" data-testid="phase-label">
          {phase}
        </Label>
      );
  }
};

export default PhaseLabel;
