import React from 'react';
import {
  Button,
  Content,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { SecurityIcon } from '@patternfly/react-icons';
import { ActionsColumn, Td, Tr } from '@patternfly/react-table';

import LabelsList from '../LabelsList';
import { getPolicySummary } from './SandboxEgressSummary';
import StatusDot from '../StatusDot';
import { formatAge } from '../../utils/formatters';
import type { Sandbox, SandboxPolicyView } from '../../types';

type PolicySummary = ReturnType<typeof getPolicySummary>;

type SandboxTableRowProps = {
  sandbox: Sandbox;
  rowIndex: number;
  isSelected: boolean;
  onSelect: (isSelecting: boolean) => void;
  onNameClick?: () => void;
  onDelete: () => void;
  onStop?: () => void;
  onStart?: () => void;
  onViewLogs: () => void;
  onOpenTerminal?: () => void;
  policyView?: SandboxPolicyView;
};

const getStatusText = (sandbox: Sandbox): string => {
  if (sandbox.status.phase === 'READY') return 'Ready';
  if (sandbox.status.phase === 'ERROR') {
    return sandbox.status.conditions?.find((c) => c.reason)?.reason ?? 'Error';
  }
  return sandbox.status.phase;
};

const SandboxTableRow: React.FC<SandboxTableRowProps> = ({
  sandbox,
  rowIndex,
  isSelected,
  onSelect,
  onNameClick,
  onDelete,
  onStop,
  onStart,
  onViewLogs,
  onOpenTerminal,
  policyView,
}) => {
  const pc: PolicySummary = getPolicySummary(
    policyView,
    sandbox.spec.policy,
    sandbox.status.currentPolicyVersion,
  );
  const providers = sandbox.spec.providers ?? [];
  const imageParts = (sandbox.spec.image || '').split('/');
  const imageShort = imageParts[imageParts.length - 1] || '-';

  const actionItems = [
    ...(onOpenTerminal ? [{ title: 'Terminal', onClick: onOpenTerminal }] : []),
    { title: 'Logs', onClick: onViewLogs },
    ...(onStop && sandbox.status.phase === 'READY'
      ? [{ title: 'Stop', onClick: onStop }]
      : []),
    ...(onStart && sandbox.status.phase === 'STOPPED'
      ? [{ title: 'Start', onClick: onStart }]
      : []),
    { title: 'Delete', onClick: onDelete },
  ];

  return (
    <Tr>
      <Td
        select={{
          rowIndex,
          onSelect: (_event, isSelecting) => onSelect(isSelecting),
          isSelected,
        }}
      />
      <Td dataLabel="Name">
        <Stack>
          <StackItem>
            <Button
              variant="link"
              isInline
              onClick={onNameClick}
              data-testid={`sandbox-link-${sandbox.metadata.name}`}
            >
              {sandbox.metadata.name}
            </Button>
          </StackItem>
          <StackItem>
            <Content
              component="small"
              style={{
                fontFamily: 'var(--pf-t--global--font--family--mono)',
              }}
            >
              {imageShort}
            </Content>
          </StackItem>
        </Stack>
      </Td>
      <Td dataLabel="Status">
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapSm' }}
          flexWrap={{ default: 'nowrap' }}
        >
          <FlexItem>
            <StatusDot phase={sandbox.status.phase} />
          </FlexItem>
          <FlexItem>
            <span
              style={{
                color:
                  sandbox.status.phase === 'ERROR'
                    ? 'var(--pf-t--global--text--color--status--danger--default)'
                    : undefined,
              }}
            >
              {getStatusText(sandbox)}
            </span>
          </FlexItem>
        </Flex>
      </Td>
      <Td dataLabel="Policy">
        <Stack>
          <StackItem>
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              gap={{ default: 'gapSm' }}
              flexWrap={{ default: 'nowrap' }}
            >
              <FlexItem>
                <SecurityIcon style={{ color: pc.iconColor }} />
              </FlexItem>
              <FlexItem>
                <strong>{pc.title}</strong>
              </FlexItem>
            </Flex>
          </StackItem>
          {pc.subtitle && (
            <StackItem>
              <Content component="small">{pc.subtitle}</Content>
            </StackItem>
          )}
        </Stack>
      </Td>
      <Td dataLabel="Providers">
        {providers.length > 0 ? (
          <LabelGroup numLabels={2}>
            {providers.map((p) => (
              <Label key={p} color="teal" isCompact>
                {p}
              </Label>
            ))}
          </LabelGroup>
        ) : (
          <Content component="small">—</Content>
        )}
      </Td>
      <Td dataLabel="Labels">
        <LabelsList labels={sandbox.metadata.labels} numLabels={2} />
      </Td>
      <Td dataLabel="Age">{formatAge(sandbox.metadata.createdAtMs)}</Td>
      <Td isActionCell>
        <ActionsColumn items={actionItems} />
      </Td>
    </Tr>
  );
};

export default SandboxTableRow;
