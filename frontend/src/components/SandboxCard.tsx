import { useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  LabelGroup,
  MenuToggle,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import {
  EllipsisVIcon,
  ScreenIcon,
} from '@patternfly/react-icons';

import type {
  DraftSandboxSummary,
  Sandbox,
  SandboxPolicyView,
} from '../types';
import LabelsList from './LabelsList';
import SandboxAttention from './SandboxAttention';
import SandboxEgressSummary from './SandboxEgressSummary';
import StatusDot from './StatusDot';
import { formatAge, formatUptime } from './utils';
import { useSlots } from '../slots';
import { Label } from '@patternfly/react-core';

type SandboxCardProps = {
  sandbox: Sandbox;
  draftSummary?: DraftSandboxSummary;
  policyView?: SandboxPolicyView;
  onDelete: (name: string) => void;
  onSelect?: (name: string) => void;
  onViewLogs?: (name: string) => void;
  onOpenTerminal?: (name: string) => void;
  onReviewDrafts?: (name: string) => void;
};

const getSubtitleText = (sandbox: Sandbox): string => {
  const { status, metadata } = sandbox;
  if (status.phase === 'READY') return formatUptime(metadata.createdAtMs);
  if (status.phase === 'PROVISIONING') return 'provisioning…';
  return `created ${formatAge(metadata.createdAtMs)} ago`;
};

const SandboxCard: React.FC<SandboxCardProps> = ({
  sandbox,
  draftSummary,
  policyView,
  onDelete,
  onSelect,
  onViewLogs,
  onOpenTerminal,
  onReviewDrafts,
}) => {
  const [isMenuOpen, setMenuOpen] = useState(false);
  const { metadata, spec, status } = sandbox;
  const providers = spec.providers ?? [];
  const hasLabels = Object.keys(metadata.labels ?? {}).length > 0;
  const pendingDrafts = draftSummary?.pendingCount ?? 0;
  const isReady = status.phase === 'READY';
  const slots = useSlots();

  return (
    <Card data-testid={`sandbox-card-${metadata.name}`}>
      {/* ── Header ── */}
      <CardBody>
        <Flex alignItems={{ default: 'alignItemsFlexStart' }} gap={{ default: 'gapMd' }}>
          <FlexItem style={{ flex: 1, minWidth: 0 }}>
            <Stack>
              <StackItem>
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  gap={{ default: 'gapSm' }}
                  flexWrap={{ default: 'nowrap' }}
                >
                  <FlexItem>
                    <StatusDot phase={status.phase} />
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant="link"
                      isInline
                      onClick={() => onSelect?.(metadata.name)}
                      style={{ fontSize: 'var(--pf-t--global--font--size--heading--xs)' }}
                      data-testid={`sandbox-card-name-${metadata.name}`}
                    >
                      {metadata.name}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Content component="small" style={{ whiteSpace: 'nowrap' }}>
                      {getSubtitleText(sandbox)}
                    </Content>
                  </FlexItem>
                </Flex>
              </StackItem>
              <StackItem>
                <Content
                  component="small"
                  style={{
                    fontFamily: 'var(--pf-t--global--font--family--mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {spec.image || '-'}
                </Content>
              </StackItem>
            </Stack>
          </FlexItem>
          <FlexItem>
            <Dropdown
              isOpen={isMenuOpen}
              onOpenChange={setMenuOpen}
              onSelect={() => setMenuOpen(false)}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  variant="plain"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  isExpanded={isMenuOpen}
                  aria-label={`Actions for ${metadata.name}`}
                  data-testid={`sandbox-card-actions-${metadata.name}`}
                >
                  <EllipsisVIcon />
                </MenuToggle>
              )}
              popperProps={{ position: 'end' }}
            >
              <DropdownList>
                <DropdownItem key="delete" onClick={() => onDelete(metadata.name)}>
                  Delete
                </DropdownItem>
              </DropdownList>
            </Dropdown>
          </FlexItem>
        </Flex>
      </CardBody>

      {/* ── Attention ── */}
      <SandboxAttention
        sandbox={sandbox}
        draftSummary={draftSummary}
        policyView={policyView}
        onReviewDrafts={onReviewDrafts}
        onViewLogs={onViewLogs}
        wrapper={(children) => <CardBody>{children}</CardBody>}
      />

      {/* ── Slot: sandbox metadata ── */}
      {slots.sandboxMetadata && (
        <CardBody>
          {slots.sandboxMetadata(metadata.workspace ?? '', metadata.name)}
        </CardBody>
      )}

      {/* ── Providers + Labels ── */}
      {(providers.length > 0 || hasLabels) && status.phase !== 'ERROR' && (
        <CardBody>
          <DescriptionList isHorizontal isCompact horizontalTermWidthModifier={{ default: '10ch' }}>
            {providers.length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Providers</DescriptionListTerm>
                <DescriptionListDescription>
                  <LabelGroup numLabels={2}>
                    {providers.map((p) => (
                      <Label key={p} color="teal" isCompact>
                        {p}
                      </Label>
                    ))}
                  </LabelGroup>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {hasLabels && (
              <DescriptionListGroup>
                <DescriptionListTerm>Labels</DescriptionListTerm>
                <DescriptionListDescription>
                  <LabelsList labels={metadata.labels} />
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
          </DescriptionList>
        </CardBody>
      )}

      {/* ── Egress ── */}
      {status.phase !== 'ERROR' && (
        <CardBody>
          <SandboxEgressSummary
            policy={spec.policy}
            policyView={policyView}
            currentPolicyVersion={status.currentPolicyVersion}
            pendingDrafts={pendingDrafts}
          />
        </CardBody>
      )}

      {/* ── Slot: sandbox actions ── */}
      {slots.sandboxActions && (
        <CardBody>
          {slots.sandboxActions(metadata.workspace ?? '', metadata.name)}
        </CardBody>
      )}

      {/* ── Footer ── */}
      <Divider />
      <CardFooter>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
          {isReady && onOpenTerminal && (
            <FlexItem>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onOpenTerminal(metadata.name)}
                icon={<ScreenIcon />}
                data-testid={`sandbox-card-terminal-${metadata.name}`}
              >
                Terminal
              </Button>
            </FlexItem>
          )}
          {onViewLogs && (
            <FlexItem>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onViewLogs(metadata.name)}
                data-testid={`sandbox-card-logs-${metadata.name}`}
              >
                Logs
              </Button>
            </FlexItem>
          )}
          <FlexItem style={{ flex: 1 }} />
          <FlexItem>
            <Button
              variant="link"
              size="sm"
              onClick={() => onSelect?.(metadata.name)}
              data-testid={`sandbox-card-details-${metadata.name}`}
            >
              Details
            </Button>
          </FlexItem>
        </Flex>
      </CardFooter>
    </Card>
  );
};

export default SandboxCard;
