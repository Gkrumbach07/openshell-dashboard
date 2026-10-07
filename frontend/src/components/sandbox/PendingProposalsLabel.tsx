import { Label, Tooltip } from '@patternfly/react-core';

import type { DraftSandboxSummary } from '../../types';

type PendingProposalsLabelProps = {
  sandboxName: string;
  summary?: DraftSandboxSummary;
  // Opens the sandbox's proposals. Without it the label is not a button.
  onReview?: () => void;
};

// The network rules waiting for a decision on a sandbox, as the TUI badges
// them beside its name ("2 pending rules"). Nothing is rendered for a sandbox
// that has none. One whose inbox could not be read says so, because that is
// not the same as having none.
const PendingProposalsLabel: React.FC<PendingProposalsLabelProps> = ({
  sandboxName,
  summary,
  onReview,
}) => {
  if (!summary) {
    return null;
  }
  if (summary.unavailable) {
    return (
      <Tooltip content="The pending rule proposals of this sandbox could not be read.">
        <Label
          variant="outline"
          isCompact
          data-testid={`sandbox-pending-unavailable-${sandboxName}`}
        >
          Proposals unavailable
        </Label>
      </Tooltip>
    );
  }
  const count = summary.pendingCount;
  if (count <= 0) {
    return null;
  }
  return (
    <Label
      color={summary.hasSecurityFlags ? 'orange' : 'blue'}
      isCompact
      onClick={onReview}
      data-testid={`sandbox-pending-${sandboxName}`}
    >
      {count} pending rule{count === 1 ? '' : 's'}
      {summary.hasSecurityFlags ? ', with findings' : ''}
    </Label>
  );
};

export default PendingProposalsLabel;
