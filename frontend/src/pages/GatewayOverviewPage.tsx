import { useState } from 'react';
import {
  Alert,
  Badge,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Content,
  DataList,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Icon,
  Label,
  LabelGroup,
  MenuToggle,
  PageSection,
  ProgressStep,
  ProgressStepper,
  Spinner,
  Timestamp,
  Title,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link } from 'react-router-dom';

import { useAllProviders, useAllSandboxes } from '../api/allWorkspaces';
import { useFeatureFlags } from '../api/auth';
import { useAllWorkspacesDraftSummary } from '../api/draftSummary';
import { useGatewayCompatibility, useGatewayInfo } from '../api/gateway';
import {
  BUILD_COMMIT,
  GATEWAY_PAGE_POLL_MS,
  GATEWAY_PAGE_PROVIDERS_POLL_MS,
} from '../constants';
import type {
  DraftSandboxSummary,
  GatewayCompatibility,
  GatewayExtensionKind,
  Sandbox,
} from '../types';
// The BFF's verdict on the gateway, in a few words. The notice that explains
// what an unsupported gateway does to the rest of the dashboard is the one
// the app shell raises above every page; this only states where the gateway
// sits, beside the version it is a verdict on.
const compatibilityText = (compatibility?: GatewayCompatibility): string => {
  const line = compatibility?.supportedLine
    ? `${compatibility.supportedLine}.x`
    : '';
  switch (compatibility?.status) {
    case 'supported':
      return line ? `Supported (${line})` : 'Supported';
    case 'unsupported':
      return line ? `Not supported (built for ${line})` : 'Not supported';
    default:
      return 'Not known';
  }
};

const EXTENSION_KIND_LABELS: Record<GatewayExtensionKind, string> = {
  COMPUTE_DRIVER: 'Compute driver',
  CREDENTIAL_DRIVER: 'Credential driver',
  GATEWAY_INTERCEPTOR: 'Gateway interceptor',
  SUPERVISOR_MIDDLEWARE: 'Supervisor middleware',
  UNSPECIFIED: 'Unspecified',
};

// A kind this build has no name for is shown as the gateway spelled it.
const extensionKindLabel = (kind: string): string =>
  (EXTENSION_KIND_LABELS as Record<string, string | undefined>)[kind] ?? kind;

const CapabilityList: React.FC<{ capabilities?: string[] }> = ({
  capabilities,
}) =>
  capabilities && capabilities.length > 0 ? (
    <LabelGroup numLabels={4}>
      {capabilities.map((capability) => (
        <Label key={capability} color="grey" isCompact>
          {capability}
        </Label>
      ))}
    </LabelGroup>
  ) : (
    <>-</>
  );

// How many of something there are, or undefined when that cannot be said.
// The lists across workspaces are answered for platform admins only and the
// gateway refuses everyone else (403), so a refusal, and a list that has not
// arrived, must not be treated as a zero.
const countOf = (query: {
  data?: unknown[];
  isError: boolean;
}): number | undefined =>
  query.isError || !query.data ? undefined : query.data.length;

// The three kinds of thing that can be waiting, which are also what the
// card's filter offers. A kind with nothing in it is not offered.
const ATTENTION_TYPES = ['proposals', 'errors', 'setup'] as const;

type AttentionType = (typeof ATTENTION_TYPES)[number];

// Plural, because the filter picks out a set of them and counts it.
const ATTENTION_TYPE_LABEL: Record<AttentionType, string> = {
  proposals: 'Proposals',
  errors: 'Sandbox errors',
  setup: 'Setup',
};

// Singular, because a badge is on one row and says what that row is.
const ATTENTION_BADGE_LABEL: Record<AttentionType, string> = {
  proposals: 'Proposal',
  errors: 'Sandbox error',
  setup: 'Setup',
};

// What a kind means, told in the badge's colour. Danger is something that has
// already gone wrong; warning is something that will unless it is dealt with;
// info — PatternFly's purple — is a decision waiting on a person, which is a
// proposal exactly. Nothing has gone wrong with a sandbox whose agent asked
// for a rule, and a card read before anything has is the wrong place to say
// otherwise.
const ATTENTION_STATUS: Record<AttentionType, 'info' | 'warning' | 'danger'> = {
  proposals: 'info',
  errors: 'danger',
  setup: 'warning',
};

// PatternFly's own status icons are the filled variants. These are the
// outline ones the masthead's health indicator uses, so one shape means one
// thing across the page.
const ATTENTION_ICON: Record<AttentionType, React.ReactElement> = {
  proposals: <InfoCircleIcon />,
  errors: <ExclamationCircleIcon />,
  setup: <ExclamationTriangleIcon />,
};

// One line of Needs attention: the thing it is about, named and badged with
// its kind, a sentence saying what is wrong with it, and when it happened.
type AttentionItem = {
  key: string;
  type: AttentionType;
  // The name of the thing, which is the link. A sandbox is named as
  // workspace/sandbox rather than counted: "3 sandboxes in error" is not
  // something anybody can act on without first finding out which three.
  text: string;
  // What the title means — a proposed rule's rationale, or why the sandbox
  // is in error, or what is missing.
  detail: string;
  to: string;
  // When it was proposed or when the error landed, for the Timestamp at the
  // end of the row. For proposals this is the newest pending chunk's
  // createdAt — the same instant the sandbox Proposals tab shows in its
  // Proposed column. Absent on rollup lines that are not about one sandbox.
  atMs?: number;
};

// What to say under a proposal row: the newest chunk's own rationale when
// the summary carried one, otherwise how many rules are waiting.
const proposalDetail = (entry: DraftSandboxSummary): string => {
  if (entry.unavailable) {
    return 'Its proposal inbox could not be read, so what is waiting in it is not known.';
  }
  if (entry.latestRationale) {
    return entry.latestRationale;
  }
  return `${entry.pendingCount} policy ${
    entry.pendingCount === 1 ? 'rule' : 'rules'
  } waiting for a decision${
    entry.hasSecurityFlags ? ', flagged by the prover' : ''
  }.`;
};

// ERROR means one of two things — the gateway could not provision the
// sandbox, or its main process exited non-zero (hard fact 1). A condition
// message says which when the gateway sent one; otherwise the log is where
// to look.
const errorCondition = (sandbox: Sandbox) =>
  sandbox.status.conditions?.find((c) => c.status === 'False' || c.reason);

const errorDetail = (sandbox: Sandbox): string =>
  errorCondition(sandbox)?.message ||
  'Provisioning failed, or the main process exited non-zero; the log says which.';

// Prefer when the error condition last changed; fall back to when the
// sandbox was created.
const errorAtMs = (sandbox: Sandbox): number | undefined => {
  const transitioned = errorCondition(sandbox)?.lastTransitionTime;
  if (transitioned) {
    const ms = Date.parse(transitioned);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }
  return sandbox.metadata.createdAtMs || undefined;
};

// How many of one kind are named before the rest become a line of their own.
// A gateway with forty sandboxes in error would otherwise be a column forty
// rows long on the page that is meant to be read first.
const ATTENTION_PER_TYPE = 4;

// Caps one kind of item, naming what it left out rather than dropping it
// quietly. `overflow` is the line that stands for the rest.
const cappedByType = (
  items: AttentionItem[],
  overflow: (hidden: number) => AttentionItem,
): AttentionItem[] =>
  items.length > ATTENTION_PER_TYPE
    ? [
        ...items.slice(0, ATTENTION_PER_TYPE),
        overflow(items.length - ATTENTION_PER_TYPE),
      ]
    : items;

// A sandbox whose proposal inbox could not be read comes first: nothing is
// known about it, which is worth more than a known count. Then the ones the
// prover flagged, then the most recently proposed. The same order the
// Proposals page puts them in.
const byProposalUrgency = (a: DraftSandboxSummary, b: DraftSandboxSummary) => {
  if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? -1 : 1;
  if (a.hasSecurityFlags !== b.hasSecurityFlags) {
    return a.hasSecurityFlags ? -1 : 1;
  }
  return b.latestDraftMs - a.latestDraftMs;
};

const sandboxPath = (workspace: string, name: string, tab: string) =>
  `/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}?tab=${tab}`;

// Gateway overview — the dashboard's landing page for a platform admin. It
// answers, in this order: is the gateway well, and is anything waiting for
// me. Versions and compatibility sit as one small line under the title; the
// gateway's compute drivers and extensions stay in the two tables a fold
// below. The API exposes no time series, no utilisation and no event feed,
// so there is nothing to chart.
const GatewayOverviewPage: React.FC = () => {
  const gateway = useGatewayInfo();
  const compatibility = useGatewayCompatibility();
  const features = useFeatureFlags();
  // This is the page a platform admin lands on and leaves open, so it reads
  // the lists across workspaces at its own, slower pace (constants.ts).
  const sandboxes = useAllSandboxes(undefined, {
    refetchInterval: GATEWAY_PAGE_POLL_MS,
  });
  const providers = useAllProviders({
    refetchInterval: GATEWAY_PAGE_PROVIDERS_POLL_MS,
  });
  // The same query the shell's Proposals badge reads, so the badge rides on
  // this page's reads while it is open.
  const proposals = useAllWorkspacesDraftSummary(features.draftPolicy, {
    refetchInterval: GATEWAY_PAGE_POLL_MS,
  });
  // Which kind of thing Needs attention is showing. Every hook runs before
  // the early returns below, so this one does too.
  const [attentionType, setAttentionType] = useState<AttentionType | 'all'>(
    'all',
  );
  const [isTypeOpen, setTypeOpen] = useState(false);

  if (gateway.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading gateway info" />
        </Bullseye>
      </PageSection>
    );
  }

  if (gateway.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title="Cannot reach the OpenShell gateway"
          actionLinks={
            <Button variant="link" onClick={() => gateway.refetch()}>
              Retry
            </Button>
          }
        >
          {(gateway.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const info = gateway.data;
  // The type marks it optional; a missing list is shown as none.
  const extensions = info?.extensions ?? [];

  const sandboxCount = countOf(sandboxes);
  const providerCount = countOf(providers);
  const gatewayVersion = info?.gatewayVersion || '-';
  // A build has no version number, only the line it is for and, when the
  // build was told, the commit it is made from (see constants.ts).
  const builtForLine = compatibility.data?.compatibility?.supportedLine;
  const dashboardBuild =
    [builtForLine ? `for ${builtForLine}.x` : '', BUILD_COMMIT]
      .filter(Boolean)
      .join(' · ') || 'Not known';
  const compatibilityLabel = compatibilityText(
    compatibility.data?.compatibility ?? info?.compatibility,
  );

  // Nothing has been made on this gateway yet. A workspace is not the test:
  // a gateway starts with `default`, so one that has only workspaces has
  // still not been used for anything.
  const isEmpty = sandboxCount === 0 && providerCount === 0;

  const erroredSandboxes = (sandboxes.data ?? []).filter(
    (sandbox) => sandbox.status.phase === 'ERROR',
  );
  // What is worth doing something about, each row leading to where it is
  // done. The gateway's own version verdict is not repeated here: it is in
  // the strip above, and the app shell raises a notice above every page when
  // it is a problem.
  //
  // After PatternFly's own dashboard events card: a status badge and a short
  // title that is the link, then a sentence beside it saying what the title
  // means and what is to be done about it.
  const attention: AttentionItem[] = [];
  // First: a rule an agent proposed is a sandbox held up until somebody
  // decides on it. One line per sandbox, named as workspace/sandbox, because
  // approving is done in that sandbox's own inbox and nowhere else (hard
  // fact 25) — a line that only counted them led to a page that counts them
  // again.
  const pendingSandboxes = [...proposals.items]
    .filter((entry) => entry.unavailable || entry.pendingCount > 0)
    .sort(byProposalUrgency);
  attention.push(
    ...cappedByType(
      pendingSandboxes.map((entry) => ({
        key: `proposals-${entry.workspace}/${entry.sandboxName}`,
        type: 'proposals' as const,
        text: `${entry.workspace}/${entry.sandboxName}`,
        detail: proposalDetail(entry),
        to: sandboxPath(entry.workspace, entry.sandboxName, 'proposals'),
        atMs:
          entry.unavailable || !entry.latestDraftMs
            ? undefined
            : entry.latestDraftMs,
      })),
      (hidden) => ({
        key: 'proposals-more',
        type: 'proposals' as const,
        text: `${hidden} more ${hidden === 1 ? 'sandbox' : 'sandboxes'} with proposals`,
        detail: 'Every sandbox with a rule waiting is on the Proposals page.',
        to: '/proposals',
      }),
    ),
  );
  // A summary that carries a total but no sandboxes is still worth saying;
  // all it can do is lead to the page that lists them.
  if (pendingSandboxes.length === 0 && proposals.totalPending > 0) {
    attention.push({
      key: 'proposals',
      type: 'proposals',
      text: `${proposals.totalPending} policy ${
        proposals.totalPending === 1 ? 'rule' : 'rules'
      } waiting for a decision`,
      detail: `An agent proposed ${
        proposals.totalPending === 1 ? 'it' : 'them'
      }. Each takes effect only once somebody approves it.`,
      to: '/proposals',
    });
  }
  attention.push(
    ...cappedByType(
      erroredSandboxes.map((sandbox) => ({
        key: `errored-${sandbox.metadata.workspace}/${sandbox.metadata.name}`,
        type: 'errors' as const,
        text: `${sandbox.metadata.workspace ?? ''}/${sandbox.metadata.name}`,
        detail: errorDetail(sandbox),
        // The row leads to the log, which is where ERROR is explained when
        // the condition did not carry a message.
        to: sandboxPath(
          sandbox.metadata.workspace ?? '',
          sandbox.metadata.name,
          'logs',
        ),
        atMs: errorAtMs(sandbox),
      })),
      (hidden) => ({
        key: 'errored-more',
        type: 'errors' as const,
        text: `${hidden} more ${hidden === 1 ? 'sandbox' : 'sandboxes'} in error`,
        detail: 'Every sandbox on the gateway is under Sandboxes.',
        to: '/sandboxes',
      }),
    ),
  );
  if (!isEmpty && providerCount === 0) {
    attention.push({
      key: 'no-providers',
      type: 'setup',
      text: 'No providers',
      detail:
        'Sandboxes have no credentials to reach a model or a service until one is added.',
      to: '/all-workspaces',
    });
  }
  // The kinds that are actually waiting, in the order the card lists them.
  const attentionTypes = ATTENTION_TYPES.filter((type) =>
    attention.some((item) => item.type === type),
  );
  // A filter held across a refresh can outlive the last item of its kind.
  const activeType =
    attentionType !== 'all' && attentionTypes.includes(attentionType)
      ? attentionType
      : 'all';
  const shownAttention =
    activeType === 'all'
      ? attention
      : attention.filter((item) => item.type === activeType);

  return (
    <>
      <PageSection>
        {/* Heading and description left; versions right. The gateway's health
            is in the masthead on every page, so these are only the facts
            that are not. */}
        <Flex
          gap={{ default: 'gapMd' }}
          flexWrap={{ default: 'wrap' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsFlexStart' }}
        >
          <FlexItem>
            <Title headingLevel="h1" className="pf-v6-u-mb-sm">
              Gateway
            </Title>
            <Content component="p">Admin view of status and alerts.</Content>
          </FlexItem>
          <FlexItem>
            <Flex
              direction={{ default: 'column' }}
              gap={{ default: 'gapXs' }}
              alignItems={{ default: 'alignItemsFlexEnd' }}
              data-testid="gateway-status-card"
            >
              <FlexItem>
                <Content component="small" data-testid="gateway-version">
                  Gateway version: {gatewayVersion}
                </Content>
              </FlexItem>
              <FlexItem>
                <Content component="small" data-testid="dashboard-version">
                  Dashboard: {dashboardBuild}
                </Content>
              </FlexItem>
              <FlexItem>
                <Content component="small" data-testid="gateway-compatibility">
                  Compatibility: {compatibilityLabel}
                </Content>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection>
        {/* One grid for the whole page, so the blocks are separated by a
            gutter rather than by a page section's padding each. Needs
            attention leads: is anything waiting. */}
        <Grid hasGutter>
          {/* Either what is waiting, or that nothing is. */}
          <GridItem span={12}>
            {attention.length > 0 ? (
              // A card of its own rather than an inline alert. An alert's
              // amber bar shouted the whole column at a page that is read
              // before anything has gone wrong; the colour belongs on the
              // one line it is about.
              <Card data-testid="gateway-attention">
                {/* The filter sits across from the heading, where the
                    PatternFly dashboard card puts it: plain text with a
                    caret, not a bordered control competing with the
                    heading. It offers only the kinds that are waiting, so
                    choosing one can never empty the card. */}
                <CardHeader
                  className="pf-v6-u-pb-md"
                  actions={{
                    actions: (
                      <Dropdown
                        isOpen={isTypeOpen}
                        onOpenChange={setTypeOpen}
                        onSelect={(_event, value) => {
                          setAttentionType(value as AttentionType | 'all');
                          setTypeOpen(false);
                        }}
                        toggle={(toggleRef) => (
                          <MenuToggle
                            ref={toggleRef}
                            variant="plainText"
                            size="sm"
                            isExpanded={isTypeOpen}
                            onClick={() => setTypeOpen(!isTypeOpen)}
                            data-testid="gateway-attention-type"
                          >
                            {activeType === 'all'
                              ? 'All types'
                              : ATTENTION_TYPE_LABEL[activeType]}
                          </MenuToggle>
                        )}
                        popperProps={{ position: 'end' }}
                      >
                        <DropdownList>
                          <DropdownItem
                            key="all"
                            value="all"
                            isSelected={activeType === 'all'}
                          >
                            {`All types (${attention.length})`}
                          </DropdownItem>
                          {attentionTypes.map((type) => (
                            <DropdownItem
                              key={type}
                              value={type}
                              isSelected={activeType === type}
                            >
                              {`${ATTENTION_TYPE_LABEL[type]} (${
                                attention.filter((item) => item.type === type)
                                  .length
                              })`}
                            </DropdownItem>
                          ))}
                        </DropdownList>
                      </Dropdown>
                    ),
                  }}
                >
                  <CardTitle component="h2">
                    Needs attention{' '}
                    {/* How many rows are under the heading, badged the way the
                        two full-width cards below badge theirs. It counts what
                        is shown rather than what is waiting, so that it agrees
                        with the list beneath it once a kind is picked. */}
                    <Badge isRead data-testid="gateway-attention-count">
                      {shownAttention.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                {/* A row is one line: badge, the name as the link, the
                    sentence saying what is wrong with it, and how long ago
                    on the right — after PatternFly's own events card. */}
                <CardBody>
                  <DataList
                    aria-label="Needs attention"
                    isCompact
                    gridBreakpoint="none"
                  >
                    {shownAttention.map((item) => (
                      <DataListItem
                        key={item.key}
                        aria-labelledby={`${item.key}-title`}
                      >
                        <DataListItemRow>
                          <DataListItemCells
                            dataListCells={[
                              <DataListCell key="item">
                                <Flex
                                  gap={{ default: 'gapSm' }}
                                  flexWrap={{ default: 'wrap' }}
                                  alignItems={{
                                    default: 'alignItemsBaseline',
                                  }}
                                >
                                  <FlexItem>
                                    <Label
                                      status={ATTENTION_STATUS[item.type]}
                                      icon={ATTENTION_ICON[item.type]}
                                      // Outlined: a filled badge on every row
                                      // shouted the column, which is the thing
                                      // the alert this card replaced was
                                      // dropped for. The outline keeps the
                                      // colour and the word and gives back
                                      // the quiet.
                                      variant="outline"
                                    >
                                      {ATTENTION_BADGE_LABEL[item.type]}
                                    </Label>
                                  </FlexItem>
                                  <FlexItem>
                                    <Link to={item.to} id={`${item.key}-title`}>
                                      {item.text}
                                    </Link>
                                  </FlexItem>
                                  <FlexItem flex={{ default: 'flex_1' }}>
                                    <Content component="small">
                                      {item.detail}
                                    </Content>
                                  </FlexItem>
                                </Flex>
                              </DataListCell>,
                              <DataListCell
                                key="when"
                                isFilled={false}
                                alignRight
                              >
                                {/* Same control the sandbox Proposals tab
                                    uses for its Proposed column, so a row
                                    here and a row there read as one clock. */}
                                {item.atMs ? (
                                  <Timestamp
                                    date={new Date(item.atMs)}
                                    data-testid={`${item.key}-age`}
                                  />
                                ) : (
                                  <Content
                                    component="small"
                                    data-testid={`${item.key}-age`}
                                  >
                                    -
                                  </Content>
                                )}
                              </DataListCell>,
                            ]}
                          />
                        </DataListItemRow>
                      </DataListItem>
                    ))}
                  </DataList>
                </CardBody>
              </Card>
            ) : (
              // The same card, built the same way, so that the row does
              // not change shape when the last thing waiting is dealt with.
              <Card data-testid="gateway-all-clear">
                <CardTitle component="h2">Needs attention</CardTitle>
                <CardBody>
                  <DataList
                    aria-label="Needs attention"
                    isCompact
                    gridBreakpoint="none"
                  >
                    <DataListItem aria-labelledby="gateway-all-clear-label">
                      <DataListItemRow>
                        <DataListItemCells
                          dataListCells={[
                            <DataListCell key="all-clear">
                              <Flex
                                gap={{ default: 'gapSm' }}
                                flexWrap={{ default: 'nowrap' }}
                                alignItems={{ default: 'alignItemsCenter' }}
                              >
                                <FlexItem>
                                  <Icon status="success">
                                    <CheckCircleIcon />
                                  </Icon>
                                </FlexItem>
                                <FlexItem id="gateway-all-clear-label">
                                  Nothing needs attention
                                </FlexItem>
                              </Flex>
                            </DataListCell>,
                          ]}
                        />
                      </DataListItemRow>
                    </DataListItem>
                  </DataList>
                </CardBody>
              </Card>
            )}
          </GridItem>
          {isEmpty && (
            <GridItem span={12}>
              <Card data-testid="gateway-get-started">
                <CardTitle>Get started</CardTitle>
                <CardBody>
                  <Content component="p">
                    Nothing has been created on this gateway yet. Three steps
                    make a sandbox an agent can work in.
                  </Content>
                  <ProgressStepper isVertical aria-label="Getting started">
                    <ProgressStep
                      id="get-started-workspace"
                      titleId="get-started-workspace-title"
                      variant="info"
                      isCurrent
                      description="A workspace holds a team's sandboxes, providers and members. The gateway starts with one called default."
                    >
                      <Link to="/workspaces">Create a workspace</Link>
                    </ProgressStep>
                    <ProgressStep
                      id="get-started-provider"
                      titleId="get-started-provider-title"
                      variant="pending"
                      description="A provider holds the credentials a sandbox uses to reach a model or a service. Its type comes from a provider profile."
                    >
                      <Link to="/workspaces">Add a provider</Link>
                    </ProgressStep>
                    <ProgressStep
                      id="get-started-sandbox"
                      titleId="get-started-sandbox-title"
                      variant="pending"
                      description="A sandbox is a secure execution environment, governed by the security policy it is created with. Attach the providers it may use."
                    >
                      <Link to="/workspaces">Create a sandbox</Link>
                    </ProgressStep>
                  </ProgressStepper>
                </CardBody>
              </Card>
            </GridItem>
          )}
          {/* What the gateway negotiated at start-up, each table under a
              heading of its own rather than behind a fold. There are a
              handful of rows in each on any real gateway, and a count in a
              toggle that has to be opened to see what it counts asks for a
              click to learn what the page could have said outright.

              Each is set off by the space the page puts between its
              heading and the first row of cards: a page section's bottom
              padding and the next one's top padding, both a medium spacer,
              which is the grid's own gutter over again. So one more of the
              same on top of the gutter, and a full-width card reads as the
              start of a band rather than as another card of the row. */}
          <GridItem span={12} className="pf-v6-u-mt-md">
            <Card data-testid="gateway-drivers-card">
              {/* The count badged rather than bracketed, the way a count
                  beside a heading is written everywhere else in the
                  dashboard, and a sentence under it saying what is being
                  counted — a table of names means nothing to a reader who
                  does not already know what a compute driver is. */}
              <CardHeader>
                <CardTitle component="h2" className="pf-v6-u-mb-sm">
                  Compute drivers{' '}
                  <Badge isRead data-testid="gateway-drivers-count">
                    {(info?.computeDrivers ?? []).length}
                  </Badge>
                </CardTitle>
                <Content component="p">
                  Pluggable components that create, inspect, and delete sandbox
                  workloads.
                </Content>
              </CardHeader>
              <CardBody>
                <Table aria-label="Compute drivers" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Driver</Th>
                      <Th>Version</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(info?.computeDrivers ?? []).map((driver) => (
                      <Tr key={driver.name}>
                        <Td dataLabel="Name">{driver.name}</Td>
                        <Td dataLabel="Driver">{driver.driverName || '-'}</Td>
                        <Td dataLabel="Version">
                          {driver.driverVersion || '-'}
                        </Td>
                      </Tr>
                    ))}
                    {(info?.computeDrivers ?? []).length === 0 && (
                      <Tr>
                        <Td colSpan={3}>No compute drivers reported</Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </CardBody>
            </Card>
          </GridItem>
          <GridItem span={12} className="pf-v6-u-mt-md">
            <Card data-testid="gateway-extensions-card">
              <CardHeader>
                <CardTitle component="h2" className="pf-v6-u-mb-sm">
                  Extensions{' '}
                  <Badge isRead data-testid="gateway-extensions-count">
                    {extensions.length}
                  </Badge>
                </CardTitle>
                <Content component="p">
                  Specialized components designed to add deployment-specific
                  behavior to the runtime while preserving core security
                  boundaries and policy controls.
                </Content>
              </CardHeader>
              <CardBody>
                <Table aria-label="Extensions" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Kind</Th>
                      <Th>Implementation</Th>
                      <Th>Protocol</Th>
                      <Th>Capabilities</Th>
                      <Th>Requires from gateway</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {extensions.map((extension) => (
                      <Tr key={`${extension.kind}/${extension.configuredName}`}>
                        <Td dataLabel="Name">
                          {extension.configuredName || '-'}
                        </Td>
                        <Td dataLabel="Kind">
                          {extensionKindLabel(extension.kind)}
                        </Td>
                        <Td dataLabel="Implementation">
                          {[
                            extension.implementationName,
                            extension.implementationVersion,
                          ]
                            .filter(Boolean)
                            .join(' ') || '-'}
                        </Td>
                        <Td dataLabel="Protocol">
                          {extension.protocolMajor}.{extension.protocolMinor}
                        </Td>
                        <Td dataLabel="Capabilities">
                          <CapabilityList
                            capabilities={extension.supportedCapabilities}
                          />
                        </Td>
                        <Td dataLabel="Requires from gateway">
                          <CapabilityList
                            capabilities={extension.requiredCapabilities}
                          />
                        </Td>
                      </Tr>
                    ))}
                    {extensions.length === 0 && (
                      <Tr>
                        <Td colSpan={6}>No extensions reported</Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default GatewayOverviewPage;
