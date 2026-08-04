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
import { AngleLeftIcon, AngleRightIcon } from '@patternfly/react-icons';

import type { DraftSandboxSummary, Sandbox, SandboxPolicyView } from '../types';
import { formatAge } from './utils';

type AlertVariant = 'danger' | 'warning' | 'info';

type AttentionItem = {
  key: string;
  variant: AlertVariant;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const buildAttentionItems = (
  sandbox: Sandbox,
  draftSummary: DraftSandboxSummary | undefined,
  policyView: SandboxPolicyView | undefined,
  callbacks?: {
    onReviewDrafts?: (name: string) => void;
    onViewLogs?: (name: string) => void;
  },
  providerExpiry?: Record<string, number>,
): AttentionItem[] => {
  const items: AttentionItem[] = [];
  const { metadata, status } = sandbox;
  const now = Date.now();

  if (status.phase === 'ERROR') {
    const condition = status.conditions?.find(
      (c) => c.status === 'False' || c.reason,
    );
    items.push({
      key: 'error',
      variant: 'danger',
      title: condition?.reason ?? 'Error',
      description:
        [
          condition?.message,
          status.currentPolicyVersion === 0 ? 'Policy never loaded' : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    });
  }

  if (policyView?.latest) {
    const rev = policyView.latest;
    if (rev.status === 'FAILED') {
      items.push({
        key: 'policy-status',
        variant: 'danger',
        title: `Policy v${rev.version} failed to load`,
        description: rev.loadError,
      });
    } else if (
      rev.status === 'PENDING' &&
      now - rev.createdAtMs > FIVE_MINUTES_MS
    ) {
      items.push({
        key: 'policy-status',
        variant: 'warning',
        title: 'Policy revision pending',
        description: `v${rev.version} was submitted ${formatAge(rev.createdAtMs)} ago and is not loaded yet`,
      });
    }
  }

  if (
    draftSummary &&
    draftSummary.pendingCount > 0 &&
    status.phase !== 'ERROR'
  ) {
    const n = draftSummary.pendingCount;
    items.push({
      key: 'drafts',
      variant: draftSummary.hasSecurityFlags ? 'warning' : 'info',
      title: draftSummary.hasSecurityFlags
        ? `${n} rule${n > 1 ? 's' : ''} proposed, with findings`
        : `${n} rule${n > 1 ? 's' : ''} proposed`,
      action: callbacks?.onReviewDrafts
        ? {
            label: 'Review',
            onClick: () => callbacks.onReviewDrafts!(metadata.name),
          }
        : undefined,
    });
  }

  if (providerExpiry) {
    const attachedProviders = sandbox.spec.providers ?? [];
    for (const name of attachedProviders) {
      const expiresMs = providerExpiry[name];
      if (expiresMs == null) continue;
      const remaining = expiresMs - now;
      if (remaining <= 0) {
        items.push({
          key: `provider-expired-${name}`,
          variant: 'danger',
          title: `Provider "${name}" credentials expired`,
        });
      } else if (remaining < ONE_DAY_MS) {
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const timeLeft =
          hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m` : '<1m';
        items.push({
          key: `provider-expiring-${name}`,
          variant: 'warning',
          title: `Provider "${name}" credentials expiring soon`,
          description: `Expires in ${timeLeft}`,
        });
      }
    }
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
  const clampedPage = Math.min(page, Math.max(0, items.length - 1));
  if (clampedPage !== page) setPage(clampedPage);
  const current = items[clampedPage];
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
  providerExpiry?: Record<string, number>;
  onReviewDrafts?: (name: string) => void;
  onViewLogs?: (name: string) => void;
  mode?: 'card' | 'detail';
  wrapper?: (children: React.ReactNode) => React.ReactNode;
};

const SandboxAttention: React.FC<SandboxAttentionProps> = ({
  sandbox,
  draftSummary,
  policyView,
  providerExpiry,
  onReviewDrafts,
  onViewLogs,
  mode = 'card',
  wrapper,
}) => {
  const items = buildAttentionItems(
    sandbox,
    draftSummary,
    policyView,
    {
      onReviewDrafts,
      onViewLogs,
    },
    providerExpiry,
  );

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
