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
  ExpandableSection,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  MenuToggle,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import {
  EllipsisVIcon,
  ScreenIcon,
  SecurityIcon,
} from '@patternfly/react-icons';

import type {
  DraftSandboxSummary,
  Sandbox,
  SandboxPolicyView,
} from '../types';
import LabelsList from './LabelsList';
import SandboxAttention from './SandboxAttention';
import StatusDot from './StatusDot';
import {
  countEgressHosts,
  formatAge,
  formatUptime,
  getEnforcementColor,
  getEnforcementLabel,
} from './utils';

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
  const [isEgressExpanded, setEgressExpanded] = useState(false);
  const { metadata, spec, status } = sandbox;
  const providers = spec.providers ?? [];
  const hasLabels = Object.keys(metadata.labels ?? {}).length > 0;
  const pendingDrafts = draftSummary?.pendingCount ?? 0;
  const isReady = status.phase === 'READY';

  const activePolicy = policyView?.latest?.policy ?? spec.policy;
  const networkPolicies = activePolicy?.networkPolicies ?? {};
  const ruleEntries = Object.entries(networkPolicies);
  const ruleCount = ruleEntries.length;
  const hostCount = countEgressHosts(networkPolicies);
  const policyVersion = policyView?.activeVersion ?? status.currentPolicyVersion;

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
          <Flex
            alignItems={{ default: 'alignItemsFlexStart' }}
            gap={{ default: 'gapSm' }}
            flexWrap={{ default: 'nowrap' }}
          >
            <FlexItem style={{ flexShrink: 0, marginTop: 2 }}>
              <SecurityIcon
                style={{
                  color: policyVersion > 0
                    ? 'var(--pf-t--global--icon--color--status--success--default)'
                    : 'var(--pf-t--global--icon--color--subtle)',
                }}
              />
            </FlexItem>
            <FlexItem style={{ minWidth: 0 }}>
              {policyVersion > 0 ? (
                <span>
                  <strong>Policy v{policyVersion} enforced</strong>
                  <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                    {' · '}
                    {hostCount > 0
                      ? `${hostCount} host${hostCount > 1 ? 's' : ''} in ${ruleCount} rule${ruleCount > 1 ? 's' : ''}`
                      : 'no egress'}
                  </span>
                </span>
              ) : (
                <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                  No policy loaded
                </span>
              )}
            </FlexItem>
            {pendingDrafts > 0 && (
              <FlexItem style={{ flexShrink: 0 }}>
                <Label color="yellow" isCompact>
                  {pendingDrafts} proposed
                </Label>
              </FlexItem>
            )}
          </Flex>

          {ruleCount > 0 && (
            <ExpandableSection
              toggleText="Allowed egress"
              isExpanded={isEgressExpanded}
              onToggle={(_e, expanded) => setEgressExpanded(expanded)}
            >
              <Stack>
                {ruleEntries.map(([name, rule], idx) => {
                  const hosts = rule.endpoints?.length ?? 0;
                  const bins = rule.binaries?.length ?? 0;
                  const enforcement = getEnforcementLabel(rule);
                  return (
                    <StackItem key={name}>
                      {idx > 0 && <Divider />}
                      <Flex
                        alignItems={{ default: 'alignItemsCenter' }}
                        gap={{ default: 'gapSm' }}
                        flexWrap={{ default: 'nowrap' }}
                        style={{ padding: 'var(--pf-t--global--spacer--sm) 0' }}
                      >
                        <FlexItem
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: 'var(--pf-t--global--font--family--mono)',
                          }}
                        >
                          {name}
                        </FlexItem>
                        <FlexItem style={{ flexShrink: 0 }}>
                          <Content component="small">
                            {hosts} host{hosts > 1 ? 's' : ''}
                            {bins > 0 && ` · ${bins} binar${bins > 1 ? 'ies' : 'y'}`}
                          </Content>
                        </FlexItem>
                        <FlexItem style={{ flexShrink: 0 }}>
                          <Label color={getEnforcementColor(enforcement)} isCompact>
                            {enforcement}
                          </Label>
                        </FlexItem>
                      </Flex>
                    </StackItem>
                  );
                })}
              </Stack>
            </ExpandableSection>
          )}
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
