import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Gallery,
  GalleryItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';

import type { DraftSandboxSummary, Sandbox, SandboxPolicyView } from '../types';
import SandboxCard from './SandboxCard';

type SandboxGalleryViewProps = {
  sandboxes: Sandbox[];
  draftSummaries?: DraftSandboxSummary[];
  policyViews?: Record<string, SandboxPolicyView>;
  onDelete: (name: string) => void;
  onSelect?: (name: string) => void;
  onViewLogs?: (name: string) => void;
  onOpenTerminal?: (name: string) => void;
  onReviewDrafts?: (name: string) => void;
  onCreateClick?: () => void;
};

const SandboxGalleryView: React.FC<SandboxGalleryViewProps> = ({
  sandboxes,
  draftSummaries,
  policyViews,
  onDelete,
  onSelect,
  onViewLogs,
  onOpenTerminal,
  onReviewDrafts,
  onCreateClick,
}) => {
  if (sandboxes.length === 0) {
    return (
      <EmptyState variant="lg" titleText="No sandboxes" icon={CubesIcon}>
        <EmptyStateBody>
          Sandboxes are secure execution environments for agents and tools. Create one to get
          started.
        </EmptyStateBody>
        {onCreateClick && (
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button
                onClick={onCreateClick}
                data-testid="create-sandbox-empty-gallery"
              >
                Create sandbox
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        )}
      </EmptyState>
    );
  }

  return (
    <Gallery hasGutter minWidths={{ default: '400px' }} data-testid="sandbox-gallery">
      {sandboxes.map((sandbox) => (
        <GalleryItem key={sandbox.metadata.name}>
          <SandboxCard
            sandbox={sandbox}
            draftSummary={draftSummaries?.find(
              (d) => d.sandboxName === sandbox.metadata.name,
            )}
            policyView={policyViews?.[sandbox.metadata.name]}
            onDelete={onDelete}
            onSelect={onSelect}
            onViewLogs={onViewLogs}
            onOpenTerminal={onOpenTerminal}
            onReviewDrafts={onReviewDrafts}
          />
        </GalleryItem>
      ))}
    </Gallery>
  );
};

export default SandboxGalleryView;
