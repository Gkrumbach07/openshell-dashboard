import React, { useState } from 'react';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockCode,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { TrashIcon } from '@patternfly/react-icons';
import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import {
  canAppendL7Rules,
  endpointRemovalEffect,
  endpointSummary,
  l7MatchSummary,
  otherEndpointFields,
} from './utils';
import type { AffectedEndpoint } from './utils';
import type { NetworkEndpoint, NetworkPolicyRule } from '../../types';

type NetworkRulesTableProps = {
  networkRules: Record<string, NetworkPolicyRule>;
  isEditable: boolean;
  isBusy: boolean;
  onRemoveRule?: (name: string) => void;
  onRemoveEndpoint?: (name: string, endpoint: NetworkEndpoint) => void;
  onAddL7Rule?: (name: string, endpoint: NetworkEndpoint) => void;
  emptyState?: React.ReactNode;
  'aria-label'?: string;
  'data-testid'?: string;
};

const NetworkRulesTable: React.FC<NetworkRulesTableProps> = ({
  networkRules,
  isEditable,
  isBusy,
  onRemoveRule,
  onRemoveEndpoint,
  onAddL7Rule,
  emptyState,
  'aria-label': ariaLabel = 'Network rules',
  'data-testid': testId = 'network-rules-table',
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The endpoint whose removal is waiting to be confirmed. It is kept by
  // where it is, so that the question is asked of the rule as it is now.
  const [removing, setRemoving] = useState<{
    ruleName: string;
    index: number;
  } | null>(null);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });

  if (Object.keys(networkRules).length === 0) {
    return (
      <>
        {emptyState ?? (
          <Alert variant="info" isInline title="No network rules">
            This sandbox has no network egress. Add an endpoint to allow
            outbound connections.
          </Alert>
        )}
      </>
    );
  }

  const columns = isEditable ? 5 : 4;

  const removingRule = removing ? networkRules[removing.ruleName] : undefined;
  const removingEndpoint = removingRule?.endpoints?.[removing?.index ?? -1];

  return (
    <>
      <Table aria-label={ariaLabel} variant="compact" data-testid={testId}>
        <Thead>
          <Tr>
            <Th screenReaderText="Expand" />
            <Th>Rule name</Th>
            <Th>Endpoints</Th>
            <Th>Binaries</Th>
            {isEditable && <Th screenReaderText="Actions" />}
          </Tr>
        </Thead>
        {Object.entries(networkRules).map(([name, rule], rowIndex) => {
          const isOpen = expanded.has(name);
          const endpoints = rule.endpoints ?? [];
          return (
            <Tbody key={name} isExpanded={isOpen}>
              <Tr data-testid={`network-rule-${name}`}>
                <Td
                  expand={{
                    rowIndex,
                    isExpanded: isOpen,
                    onToggle: () => toggle(name),
                  }}
                />
                <Td dataLabel="Rule name">
                  <Label isCompact color="blue">
                    {name}
                  </Label>
                  {rule.name && rule.name !== name && (
                    <Content component="small"> {rule.name}</Content>
                  )}
                </Td>
                <Td dataLabel="Endpoints">
                  {endpoints.length > 0 ? (
                    <LabelGroup numLabels={4}>
                      {endpoints.map((ep, i) => (
                        <Label key={i} isCompact color="teal">
                          {endpointSummary(ep)}
                        </Label>
                      ))}
                    </LabelGroup>
                  ) : (
                    '-'
                  )}
                </Td>
                <Td dataLabel="Binaries">
                  {(rule.binaries ?? []).map((b) => b.path).join(', ') ||
                    'Any binary'}
                </Td>
                {isEditable && (
                  <Td isActionCell>
                    <Button
                      variant="plain"
                      icon={<TrashIcon />}
                      onClick={() => onRemoveRule?.(name)}
                      isDisabled={isBusy}
                      aria-label={`Remove rule ${name}`}
                      data-testid={`remove-rule-${name}`}
                    />
                  </Td>
                )}
              </Tr>
              <Tr isExpanded={isOpen}>
                <Td dataLabel="Details" colSpan={columns}>
                  <ExpandableRowContent>
                    {isOpen && (
                      <Stack hasGutter>
                        {endpoints.map((ep, i) => (
                          <StackItem key={i}>
                            <EndpointDetails
                              endpoint={ep}
                              testId={`endpoint-${name}-${i}`}
                              isEditable={isEditable}
                              isBusy={isBusy}
                              onRemove={() =>
                                setRemoving({ ruleName: name, index: i })
                              }
                              onAddL7Rule={() => onAddL7Rule?.(name, ep)}
                            />
                          </StackItem>
                        ))}
                        <StackItem>
                          <Content component="small">
                            The rule as the gateway holds it, every field
                            included:
                          </Content>
                          <CodeBlock>
                            <CodeBlockCode data-testid={`rule-json-${name}`}>
                              {JSON.stringify(rule, null, 2)}
                            </CodeBlockCode>
                          </CodeBlock>
                        </StackItem>
                      </Stack>
                    )}
                  </ExpandableRowContent>
                </Td>
              </Tr>
            </Tbody>
          );
        })}
      </Table>
      {removing && removingRule && removingEndpoint && (
        <RemoveEndpointModal
          ruleName={removing.ruleName}
          rule={removingRule}
          endpoint={removingEndpoint}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null);
            onRemoveEndpoint?.(removing.ruleName, removingEndpoint);
          }}
        />
      )}
    </>
  );
};

// What becomes of one endpoint the removal touches, in a few words.
const removalOutcome = ({
  removedPorts,
  remainingPorts,
}: AffectedEndpoint): string => {
  if (remainingPorts.length === 0) {
    return 'is removed';
  }
  const lost = removedPorts.length === 1 ? 'port' : 'ports';
  return `loses ${lost} ${removedPorts.join(', ')} and keeps ${remainingPorts.join(', ')}`;
};

type RemoveEndpointModalProps = {
  ruleName: string;
  rule: NetworkPolicyRule;
  endpoint: NetworkEndpoint;
  onConfirm: () => void;
  onCancel: () => void;
};

// The question before an endpoint is removed. The gateway removes by host and
// port (`openshell policy update --remove-endpoint host:port`), in every
// endpoint of the rule that has them, so what is removed can be more than the
// endpoint that was chosen: every endpoint it reaches is named here, with
// what is left of it, and so is the rule when nothing is left of that.
const RemoveEndpointModal: React.FC<RemoveEndpointModalProps> = ({
  ruleName,
  rule,
  endpoint,
  onConfirm,
  onCancel,
}) => {
  const { affected, removesRule } = endpointRemovalEffect(rule, endpoint);
  const others = affected.filter((item) => item.endpoint !== endpoint);

  return (
    <Modal
      variant="medium"
      isOpen
      onClose={onCancel}
      aria-label="Remove endpoint"
      data-testid="remove-endpoint-modal"
    >
      <ModalHeader
        title={`Remove an endpoint from ${ruleName}?`}
        titleIconVariant="warning"
      />
      <ModalBody>
        {affected.length === 0 ? (
          <Content component="p" data-testid="remove-endpoint-unremovable">
            <strong>{endpointSummary(endpoint)}</strong> names no port. The
            gateway removes an endpoint by its host and port, so this one cannot
            be removed here: take it out of the policy under Document.
          </Content>
        ) : (
          <Stack hasGutter>
            <StackItem>
              <Content component="p">
                The gateway removes an endpoint by its host and port, from every
                endpoint of the rule that has them, whatever its path. Removing{' '}
                <strong>{endpointSummary(endpoint)}</strong> changes the rule
                like this:
              </Content>
            </StackItem>
            <StackItem>
              <List data-testid="remove-endpoint-effect">
                {affected.map((item) => (
                  <ListItem key={item.index}>
                    <strong>{endpointSummary(item.endpoint)}</strong>{' '}
                    {removalOutcome(item)}
                    {item.endpoint === endpoint ? '' : ' (another endpoint)'}
                  </ListItem>
                ))}
              </List>
            </StackItem>
            {others.length > 0 && (
              <StackItem>
                <Alert
                  variant="warning"
                  isInline
                  title={`${others.length === 1 ? 'Another endpoint' : `${others.length} other endpoints`} of this rule ${others.length === 1 ? 'has' : 'have'} the same host and port`}
                  data-testid="remove-endpoint-others"
                >
                  To remove only the endpoint you chose, edit the policy under
                  Document.
                </Alert>
              </StackItem>
            )}
            {removesRule && (
              <StackItem>
                <Content component="p" data-testid="remove-endpoint-rule">
                  That leaves the rule <strong>{ruleName}</strong> without an
                  endpoint, so the rule is removed as well.
                </Content>
              </StackItem>
            )}
          </Stack>
        )}
      </ModalBody>
      <ModalFooter>
        {affected.length > 0 && (
          <Button
            variant="danger"
            onClick={onConfirm}
            data-testid="confirm-remove-endpoint"
          >
            Remove
          </Button>
        )}
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

type EndpointDetailsProps = {
  endpoint: NetworkEndpoint;
  testId: string;
  isEditable: boolean;
  isBusy: boolean;
  onRemove: () => void;
  onAddL7Rule: () => void;
};

const EndpointDetails: React.FC<EndpointDetailsProps> = ({
  endpoint,
  testId,
  isEditable,
  isBusy,
  onRemove,
  onAddL7Rule,
}) => {
  const allow = endpoint.rules ?? [];
  const deny = endpoint.denyRules ?? [];
  const others = otherEndpointFields(endpoint);

  return (
    <Stack data-testid={testId}>
      <StackItem>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapSm' }}
        >
          <FlexItem>
            <strong>{endpointSummary(endpoint)}</strong>
          </FlexItem>
          {isEditable && canAppendL7Rules(endpoint) && (
            <FlexItem>
              <Button
                variant="link"
                isInline
                onClick={onAddL7Rule}
                isDisabled={isBusy}
                data-testid={`${testId}-add-l7-rule`}
              >
                Add request rule
              </Button>
            </FlexItem>
          )}
          {isEditable && (
            <FlexItem>
              <Button
                variant="link"
                isInline
                isDanger
                onClick={onRemove}
                isDisabled={isBusy}
                data-testid={`${testId}-remove`}
              >
                Remove endpoint
              </Button>
            </FlexItem>
          )}
        </Flex>
      </StackItem>
      {(allow.length > 0 || deny.length > 0 || others.length > 0) && (
        <StackItem>
          <DescriptionList isCompact isHorizontal>
            {allow.length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Allow</DescriptionListTerm>
                <DescriptionListDescription>
                  <List isPlain>
                    {allow.map((rule, i) => (
                      <ListItem key={i}>{l7MatchSummary(rule.allow)}</ListItem>
                    ))}
                  </List>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {deny.length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Deny</DescriptionListTerm>
                <DescriptionListDescription>
                  <List isPlain>
                    {deny.map((rule, i) => (
                      <ListItem key={i}>{l7MatchSummary(rule)}</ListItem>
                    ))}
                  </List>
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {others.length > 0 && (
              <DescriptionListGroup>
                <DescriptionListTerm>Also sets</DescriptionListTerm>
                <DescriptionListDescription>
                  {others.join(', ')}
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
          </DescriptionList>
        </StackItem>
      )}
    </Stack>
  );
};

export default NetworkRulesTable;
