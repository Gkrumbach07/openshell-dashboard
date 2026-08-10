import { useState } from 'react';
import {
  Content,
  Divider,
  ExpandableSection,
  Flex,
  FlexItem,
  Label,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { SecurityIcon } from '@patternfly/react-icons';

import type {
  NetworkPolicyRule,
  SandboxPolicy,
  SandboxPolicyView,
} from '../../types';

export const countEgressHosts = (
  policies: Record<string, NetworkPolicyRule>,
): number => {
  const hosts = new Set<string>();
  for (const rule of Object.values(policies)) {
    for (const ep of rule.endpoints ?? []) {
      if (ep.host) hosts.add(`${ep.host}:${ep.port ?? 443}`);
    }
  }
  return hosts.size;
};

export const getEnforcementLabel = (rule: NetworkPolicyRule): string => {
  const ep = rule.endpoints?.[0];
  if (!ep) return 'enforce';
  if (ep.advisorProposed) return 'advisor';
  return ep.enforcement ?? 'enforce';
};

export const getEnforcementColor = (
  mode: string,
): 'green' | 'blue' | 'grey' => {
  if (mode === 'enforce') return 'green';
  if (mode === 'observe' || mode === 'advisor') return 'blue';
  return 'grey';
};

type SandboxEgressSummaryProps = {
  policy?: SandboxPolicy;
  policyView?: SandboxPolicyView;
  currentPolicyVersion: number;
  pendingDrafts?: number;
};

export const getPolicySummary = (
  policyView: SandboxPolicyView | undefined,
  fallbackPolicy: SandboxPolicy | undefined,
  currentPolicyVersion: number,
) => {
  const policy = policyView?.latest?.policy ?? fallbackPolicy;
  const version = policyView?.activeVersion ?? currentPolicyVersion;
  const np = policy?.networkPolicies ?? {};
  const ruleCount = Object.keys(np).length;
  const hostCount = countEgressHosts(np);
  const latestStatus = policyView?.latest?.status;

  let title: string;
  let iconColor: string;
  if (version === 0 || !policy) {
    title = 'Never loaded';
    iconColor = 'var(--pf-t--global--icon--color--status--warning--default)';
  } else if (latestStatus === 'PENDING') {
    title = `v${version} pending`;
    iconColor = 'var(--pf-t--global--icon--color--subtle)';
  } else if (latestStatus === 'FAILED') {
    title = `v${version} failed`;
    iconColor = 'var(--pf-t--global--icon--color--status--danger--default)';
  } else {
    title = `v${version} enforced`;
    iconColor = 'var(--pf-t--global--icon--color--status--success--default)';
  }

  let subtitle = '';
  if (version > 0 && hostCount > 0) {
    subtitle = `${hostCount} host${hostCount > 1 ? 's' : ''} in ${ruleCount} rule${ruleCount > 1 ? 's' : ''}`;
  } else if (version > 0) {
    subtitle = `v${version} defined, no egress`;
  }

  return { title, iconColor, subtitle, version, networkPolicies: np };
};

const EgressRuleList: React.FC<{ rules: [string, NetworkPolicyRule][] }> = ({
  rules,
}) => (
  <Stack>
    {rules.map(([name, rule], idx) => {
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
            className="pf-v6-u-py-sm"
          >
            <FlexItem
              flex={{ default: 'flex_1' }}
              className="pf-v6-u-text-truncate pf-v6-u-font-family-monospace"
              style={{ minWidth: 0 }}
            >
              {name}
            </FlexItem>
            <FlexItem
              grow={{ default: 'grow' }}
              className="pf-v6-u-flex-shrink-0"
            >
              <Content component="small">
                {hosts} host{hosts > 1 ? 's' : ''}
                {bins > 0 && ` · ${bins} binar${bins > 1 ? 'ies' : 'y'}`}
              </Content>
            </FlexItem>
            <FlexItem
              grow={{ default: 'grow' }}
              className="pf-v6-u-flex-shrink-0"
            >
              <Label color={getEnforcementColor(enforcement)} isCompact>
                {enforcement}
              </Label>
            </FlexItem>
          </Flex>
        </StackItem>
      );
    })}
  </Stack>
);

const SandboxEgressSummary: React.FC<SandboxEgressSummaryProps> = ({
  policy,
  policyView,
  currentPolicyVersion,
  pendingDrafts = 0,
}) => {
  const [isExpanded, setExpanded] = useState(false);
  const summary = getPolicySummary(policyView, policy, currentPolicyVersion);
  const ruleEntries = Object.entries(summary.networkPolicies);

  return (
    <>
      <Flex
        alignItems={{ default: 'alignItemsFlexStart' }}
        gap={{ default: 'gapSm' }}
        flexWrap={{ default: 'nowrap' }}
      >
        <FlexItem className="pf-v6-u-flex-shrink-0">
          <SecurityIcon style={{ color: summary.iconColor }} />
        </FlexItem>
        <FlexItem style={{ minWidth: 0 }}>
          {summary.version > 0 ? (
            <span>
              <strong>Policy v{summary.version} enforced</strong>
              <Content
                component="small"
                className="pf-v6-u-display-inline pf-v6-u-text-color-subtle"
              >
                {' · '}
                {summary.subtitle || 'no egress'}
              </Content>
            </span>
          ) : (
            <Content component="small" className="pf-v6-u-text-color-subtle">
              No policy loaded
            </Content>
          )}
        </FlexItem>
        {pendingDrafts > 0 && (
          <FlexItem className="pf-v6-u-flex-shrink-0">
            <Label color="yellow" isCompact>
              {pendingDrafts} proposed
            </Label>
          </FlexItem>
        )}
      </Flex>

      {ruleEntries.length > 0 && (
        <ExpandableSection
          toggleText="Allowed egress"
          isExpanded={isExpanded}
          onToggle={(_e, expanded) => setExpanded(expanded)}
        >
          <EgressRuleList rules={ruleEntries} />
        </ExpandableSection>
      )}
    </>
  );
};

export default SandboxEgressSummary;
