import { EmptyState, EmptyStateBody } from '@patternfly/react-core';
import { CubeIcon } from '@patternfly/react-icons';

/**
 * Shown wherever sandbox templates would appear when the gateway has no
 * template RPCs — OpenShell 0.0.116 does not — and the BFF therefore answers
 * 501. Nothing is broken and nothing can be retried, so this is an empty
 * state, not an error alert.
 */
const TemplatesUnsupported: React.FC = () => (
  <EmptyState
    variant="lg"
    titleText="Sandbox templates are not available"
    icon={CubeIcon}
    data-testid="templates-unsupported"
  >
    <EmptyStateBody>
      This gateway does not support sandbox templates. Sandboxes can still be
      created directly.
    </EmptyStateBody>
  </EmptyState>
);

export default TemplatesUnsupported;
