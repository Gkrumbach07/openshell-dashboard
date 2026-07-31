import { useState } from 'react';
import {
  Alert,
  AlertActionCloseButton,
  AlertActionLink,
  AlertGroup,
  Button,
  Content,
  Flex,
  FlexItem,
} from '@patternfly/react-core';
import {
  AngleLeftIcon,
  AngleRightIcon,
} from '@patternfly/react-icons';

import type {
  DraftSandboxSummary,
  Sandbox,
  SandboxPolicyView,
} from '../types';
import { formatAge } from './utils';

type AlertVariant = 'danger' | 'warning' | 'info';

type AttentionItem = {
  key: string;
  variant: AlertVariant;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

export const buildAttentionItems = (
  sandbox: Sandbox,
  draftSummary: DraftSandboxSummary | undefined,
  policyView: SandboxPolicyView | undefined,
  callbacks?: {
    onReviewDrafts?: (name: string) => void;
    onViewLogs?: (name: string) => void;
  },
): AttentionItem[] => {
  const items: AttentionItem[] = [];
  const { metadata, status } = sandbox;

  if (status.phase === 'ERROR') {
    const condition = status.conditions?.find((c) => c.status === 'False' || c.reason);
    items.push({
      key: 'error',
      variant: 'danger',
      title: condition?.reason ?? 'Error',
      description: [
        condition?.message,
        status.currentPolicyVersion === 0 ? 'Policy never loaded' : undefined,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    });
  }

  if (policyView?.latest) {
    const rev = policyView.latest;
    if (rev.status === 'PENDING' || rev.status === 'FAILED') {
      items.push({
        key: 'policy-status',
        variant: rev.status === 'FAILED' ? 'danger' : 'warning',
        title:
          rev.status === 'FAILED'
            ? `Policy v${rev.version} failed to load`
            : 'Policy revision pending',
        description:
          rev.status === 'FAILED'
            ? rev.loadError
            : `v${rev.version} was submitted ${formatAge(rev.createdAtMs)} ago and is not loaded yet`,
      });
    }
  }

  if (draftSummary && draftSummary.pendingCount > 0 && status.phase !== 'ERROR') {
    const n = draftSummary.pendingCount;
    items.push({
      key: 'drafts',
      variant: draftSummary.hasSecurityFlags ? 'warning' : 'info',
      title: draftSummary.hasSecurityFlags
        ? `${n} rule${n > 1 ? 's' : ''} proposed, with findings`
        : `${n} rule${n > 1 ? 's' : ''} proposed`,
      action: callbacks?.onReviewDrafts
        ? { label: 'Review', onClick: () => callbacks.onReviewDrafts!(metadata.name) }
        : undefined,
    });
  }

  return items;
};

const renderAlert = (
  item: AttentionItem,
  opts?: { dismissable?: boolean; onDismiss?: () => void },
) => (
  <Alert
    key={item.key}
    variant={item.variant}
    isInline
    title={item.title}
    actionClose={
      opts?.dismissable ? (
        <AlertActionCloseButton onClose={opts.onDismiss} />
      ) : undefined
    }
    actionLinks={
      item.action ? (
        <AlertActionLink onClick={item.action.onClick}>
          {item.action.label}
        </AlertActionLink>
      ) : undefined
    }
    data-testid={`attention-${item.key}`}
  >
    {item.description && <Content component="p">{item.description}</Content>}
  </Alert>
);

// ── Card mode: single alert with prev/next pagination in top-right ──

const CardAttention: React.FC<{ items: AttentionItem[] }> = ({ items }) => {
  const [page, setPage] = useState(0);
  const current = items[page];
  if (!current) return null;

  return (
    <div>
      {renderAlert(current)}
      {items.length > 1 && (
        <Flex
          justifyContent={{ default: 'justifyContentFlexEnd' }}
          alignItems={{ default: 'alignItemsCenter' }}
          spaceItems={{ default: 'spaceItemsNone' }}
        >
          <FlexItem>
            <Button
              variant="plain"
              size="sm"
              isDisabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous alert"
            >
              <AngleLeftIcon />
            </Button>
          </FlexItem>
          <FlexItem>
            <Content component="small">
              {page + 1}/{items.length}
            </Content>
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              size="sm"
              isDisabled={page === items.length - 1}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next alert"
            >
              <AngleRightIcon />
            </Button>
          </FlexItem>
        </Flex>
      )}
    </div>
  );
};

// ── Detail mode: stacked AlertGroupInline, each dismissable ──

const DetailAttention: React.FC<{ items: AttentionItem[] }> = ({ items }) => {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = items.filter((item) => !dismissed.has(item.key));
  if (visible.length === 0) return null;

  return (
    <AlertGroup>
      {visible.map((item) =>
        renderAlert(item, {
          dismissable: true,
          onDismiss: () => setDismissed((prev) => new Set(prev).add(item.key)),
        }),
      )}
    </AlertGroup>
  );
};

// ── Public component ──

type SandboxAttentionProps = {
  sandbox: Sandbox;
  draftSummary?: DraftSandboxSummary;
  policyView?: SandboxPolicyView;
  onReviewDrafts?: (name: string) => void;
  onViewLogs?: (name: string) => void;
  mode?: 'card' | 'detail';
  wrapper?: (children: React.ReactNode) => React.ReactNode;
};

const SandboxAttention: React.FC<SandboxAttentionProps> = ({
  sandbox,
  draftSummary,
  policyView,
  onReviewDrafts,
  onViewLogs,
  mode = 'card',
  wrapper,
}) => {
  const items = buildAttentionItems(sandbox, draftSummary, policyView, {
    onReviewDrafts,
    onViewLogs,
  });

  if (items.length === 0) return null;

  const content =
    mode === 'detail' ? (
      <DetailAttention items={items} />
    ) : (
      <CardAttention items={items} />
    );

  return wrapper ? <>{wrapper(content)}</> : content;
};

export default SandboxAttention;
