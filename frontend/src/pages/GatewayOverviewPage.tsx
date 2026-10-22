import { useEffect, useState } from 'react';
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
  QuestionCircleIcon,
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
import { useI18n } from '../i18n';
import type {
  DraftSandboxSummary,
  GatewayCompatibility,
  Sandbox,
  ServiceStatus,
} from '../types';

type Translate = ReturnType<typeof useI18n>['t'];

// The BFF's verdict on the gateway, in a few words. The notice that explains
// what an unsupported gateway does to the rest of the dashboard is the one
// the app shell raises above every page; this only states where the gateway
// sits, beside the version it is a verdict on.
const compatibilityText = (
  t: Translate,
  compatibility?: GatewayCompatibility,
): string => {
  const line = compatibility?.supportedLine
    ? `${compatibility.supportedLine}.x`
    : '';
  switch (compatibility?.status) {
    case 'supported':
      return line
        ? t('compatibility.supportedLine', { line })
        : t('compatibility.supported');
    case 'unsupported':
      return line
        ? t('compatibility.unsupportedLine', { line })
        : t('compatibility.unsupported');
    default:
      return t('compatibility.notKnown');
  }
};

// The gateway's own status from GetGatewayInfo. The masthead's indicator is
// the health check, which is a yes or a no; DEGRADED is only said here.
const statusColor = (
  status: ServiceStatus,
): 'green' | 'orange' | 'red' | 'grey' => {
  switch (status) {
    case 'HEALTHY':
      return 'green';
    case 'DEGRADED':
      return 'orange';
    case 'UNHEALTHY':
      return 'red';
    default:
      return 'grey';
  }
};

const statusIcon = (status: ServiceStatus) => {
  switch (status) {
    case 'HEALTHY':
      return <CheckCircleIcon />;
    case 'DEGRADED':
      return <ExclamationTriangleIcon />;
    case 'UNHEALTHY':
      return <ExclamationCircleIcon />;
    default:
      return <QuestionCircleIcon />;
  }
};

const EXTENSION_KINDS = new Set([
  'COMPUTE_DRIVER',
  'CREDENTIAL_DRIVER',
  'GATEWAY_INTERCEPTOR',
  'SUPERVISOR_MIDDLEWARE',
  'UNSPECIFIED',
]);

// A kind this build has no name for is shown as the gateway spelled it.
const extensionKindLabel = (t: Translate, kind: string): string =>
  EXTENSION_KINDS.has(kind) ? t(`extensions.kinds.${kind}`) : kind;

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

// The kinds of thing that can be waiting, which are also what the card's
// filter offers. A kind with nothing in it is not offered. A list that could
// not be read leads: until it is, nothing else on the card is the whole story.
const ATTENTION_TYPES = ['unread', 'proposals', 'errors', 'setup'] as const;

type AttentionType = (typeof ATTENTION_TYPES)[number];

// What a kind means, told in the badge's colour. Danger is something that has
// already gone wrong (a sandbox in error, a list the page could not read);
// warning is something that will unless it is dealt with; info — PatternFly's
// purple — is a decision waiting on a person, which is a proposal exactly.
const ATTENTION_STATUS: Record<AttentionType, 'info' | 'warning' | 'danger'> = {
  unread: 'danger',
  proposals: 'info',
  errors: 'danger',
  setup: 'warning',
};

// PatternFly's own status icons are the filled variants. These are the
// outline ones the masthead's health indicator uses, so one shape means one
// thing across the page.
const ATTENTION_ICON: Record<AttentionType, React.ReactElement> = {
  unread: <ExclamationCircleIcon />,
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
const proposalDetail = (t: Translate, entry: DraftSandboxSummary): string => {
  if (entry.unavailable) {
    return t('attention.proposals.unavailable');
  }
  if (entry.latestRationale) {
    return entry.latestRationale;
  }
  return entry.hasSecurityFlags
    ? t('attention.proposals.pendingFlagged', { count: entry.pendingCount })
    : t('attention.proposals.pending', { count: entry.pendingCount });
};

// ERROR means one of two things — the gateway could not provision the
// sandbox, or its main process exited non-zero (hard fact 1). A condition
// message says which when the gateway sent one; otherwise the log is where
// to look. The Ready condition that is False is the one that says why; any
// other False condition is the next best.
const errorCondition = (sandbox: Sandbox) => {
  const conditions = sandbox.status.conditions ?? [];
  return (
    conditions.find((c) => c.type === 'Ready' && c.status === 'False') ??
    conditions.find((c) => c.status === 'False')
  );
};

const errorDetail = (t: Translate, sandbox: Sandbox): string =>
  errorCondition(sandbox)?.message || t('attention.errors.detail');

// When the error condition last changed. A sandbox's creation time is not
// when it went into error, so without a transition time there is no time.
const errorAtMs = (sandbox: Sandbox): number | undefined => {
  const transitioned = errorCondition(sandbox)?.lastTransitionTime;
  if (!transitioned) {
    return undefined;
  }
  const ms = Date.parse(transitioned);
  return Number.isNaN(ms) ? undefined : ms;
};

// Newest error first; one with no known time goes last.
const byErrorTime = (a: Sandbox, b: Sandbox) =>
  (errorAtMs(b) ?? -Infinity) - (errorAtMs(a) ?? -Infinity) || 0;

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

// One row of the card that is not an item: the all-clear, or that the lists
// are still being read. The same DataList the items are in, so the card does
// not change shape between the three.
const AttentionNote: React.FC<{
  id: string;
  icon: React.ReactNode;
  text: string;
}> = ({ id, icon, text }) => (
  <DataListItem aria-labelledby={id}>
    <DataListItemRow>
      <DataListItemCells
        dataListCells={[
          <DataListCell key="note">
            <Flex
              gap={{ default: 'gapSm' }}
              flexWrap={{ default: 'nowrap' }}
              alignItems={{ default: 'alignItemsCenter' }}
            >
              <FlexItem>{icon}</FlexItem>
              <FlexItem id={id}>{text}</FlexItem>
            </Flex>
          </DataListCell>,
        ]}
      />
    </DataListItemRow>
  </DataListItem>
);

// Gateway overview — the dashboard's landing page for a platform admin. It
// answers, in this order: is the gateway well, and is anything waiting for
// me. The gateway's status, versions and compatibility sit as one small strip
// beside the title; the gateway's compute drivers and extensions stay in the
// two tables below. The API exposes no time series, no utilisation and no
// event feed, so there is nothing to chart.
const GatewayOverviewPage: React.FC = () => {
  const { t } = useI18n('gateway');
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

  const sandboxCount = countOf(sandboxes);
  const providerCount = countOf(providers);
  // Proposals are read only where draft policies are switched on; elsewhere
  // there is nothing to wait for.
  const proposalsRead = features.draftPolicy;

  // A list that has not answered yet. One that failed is not loading: it is
  // a row of its own below.
  const isLoadingLists =
    (!sandboxes.isError && !sandboxes.data) ||
    (!providers.isError && !providers.data) ||
    (proposalsRead && proposals.isLoading);

  // Nothing has been made on this gateway yet. A workspace is not the test:
  // a gateway starts with `default`, so one that has only workspaces has
  // still not been used for anything.
  const isEmpty = sandboxCount === 0 && providerCount === 0;

  // What is worth doing something about, each row leading to where it is
  // done. The gateway's own version verdict is not repeated here: it is in
  // the strip above, and the app shell raises a notice above every page when
  // it is a problem.
  //
  // After PatternFly's own dashboard events card: a status badge and a short
  // title that is the link, then a sentence beside it saying what the title
  // means and what is to be done about it.
  const attention: AttentionItem[] = [];
  // First: a list that could not be read. Whatever it holds is not known, so
  // the card must not read as having nothing to do.
  const unread: [string, boolean, string, unknown][] = [
    ['sandboxes', sandboxes.isError, '/sandboxes', sandboxes.error],
    ['providers', providers.isError, '/all-workspaces', providers.error],
    [
      'proposals',
      proposalsRead && proposals.isError,
      '/proposals',
      proposals.error,
    ],
  ];
  for (const [list, failed, to, error] of unread) {
    if (failed) {
      attention.push({
        key: `unread-${list}`,
        type: 'unread',
        text: t(`attention.unread.${list}`),
        detail:
          (error instanceof Error && error.message) ||
          t('attention.unread.detail'),
        to,
      });
    }
  }
  // Then a rule proposed for a sandbox, from a connection it was denied: the
  // sandbox is held up until somebody decides on it. One line per sandbox,
  // named as workspace/sandbox, because approving is done in that sandbox's
  // own inbox and nowhere else (hard fact 25) — a line that only counted
  // them led to a page that counts them again.
  const proposalItems =
    proposalsRead && !proposals.isError ? proposals.items : [];
  const totalPending =
    proposalsRead && !proposals.isError ? proposals.totalPending : 0;
  const pendingSandboxes = [...proposalItems]
    .filter((entry) => entry.unavailable || entry.pendingCount > 0)
    .sort(byProposalUrgency);
  attention.push(
    ...cappedByType(
      pendingSandboxes.map((entry) => ({
        key: `proposals-${entry.workspace}/${entry.sandboxName}`,
        type: 'proposals' as const,
        text: `${entry.workspace}/${entry.sandboxName}`,
        detail: proposalDetail(t, entry),
        to: sandboxPath(entry.workspace, entry.sandboxName, 'proposals'),
        atMs:
          entry.unavailable || !entry.latestDraftMs
            ? undefined
            : entry.latestDraftMs,
      })),
      (hidden) => ({
        key: 'proposals-more',
        type: 'proposals' as const,
        text: t('attention.proposals.more', { count: hidden }),
        detail: t('attention.proposals.moreDetail'),
        to: '/proposals',
      }),
    ),
  );
  // A summary that carries a total but no sandboxes is still worth saying;
  // all it can do is lead to the page that lists them.
  if (pendingSandboxes.length === 0 && totalPending > 0) {
    attention.push({
      key: 'proposals',
      type: 'proposals',
      text: t('attention.proposals.total', { count: totalPending }),
      detail: t('attention.proposals.totalDetail'),
      to: '/proposals',
    });
  }
  // A list that failed names no sandboxes, even one it held before: a row
  // above says it could not be read.
  const erroredSandboxes = (sandboxes.isError ? [] : (sandboxes.data ?? []))
    .filter((sandbox) => sandbox.status.phase === 'ERROR')
    .sort(byErrorTime);
  attention.push(
    ...cappedByType(
      erroredSandboxes.map((sandbox) => ({
        key: `errored-${sandbox.metadata.workspace}/${sandbox.metadata.name}`,
        type: 'errors' as const,
        text: `${sandbox.metadata.workspace ?? ''}/${sandbox.metadata.name}`,
        detail: errorDetail(t, sandbox),
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
        text: t('attention.errors.more', { count: hidden }),
        detail: t('attention.errors.moreDetail'),
        to: '/sandboxes',
      }),
    ),
  );
  if (!isEmpty && providerCount === 0) {
    attention.push({
      key: 'no-providers',
      type: 'setup',
      text: t('attention.setup.noProviders'),
      detail: t('attention.setup.noProvidersDetail'),
      to: '/all-workspaces',
    });
  }
  // The kinds that are actually waiting, in the order the card lists them.
  const attentionTypes = ATTENTION_TYPES.filter((type) =>
    attention.some((item) => item.type === type),
  );
  // A filter held across a refresh can outlive the last item of its kind.
  // It is shown as All types at once, and dropped, so that it does not come
  // back by itself when an item of that kind next appears.
  const isFilterOffered =
    attentionType === 'all' || attentionTypes.includes(attentionType);
  useEffect(() => {
    if (!isFilterOffered) {
      setAttentionType('all');
    }
  }, [isFilterOffered]);

  if (gateway.isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label={t('loading')} />
        </Bullseye>
      </PageSection>
    );
  }

  if (gateway.isError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={t('loadFailed')}
          actionLinks={
            <Button variant="link" onClick={() => gateway.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {(gateway.error as Error).message}
        </Alert>
      </PageSection>
    );
  }

  const info = gateway.data;
  const status: ServiceStatus = info?.status ?? 'UNSPECIFIED';
  // The type marks it optional; a missing list is shown as none.
  const extensions = info?.extensions ?? [];
  const computeDrivers = info?.computeDrivers ?? [];

  const gatewayVersion = info?.gatewayVersion || '-';
  // A build has no version number, only the line it is for and, when the
  // build was told, the commit it is made from (see constants.ts).
  const builtForLine = compatibility.data?.compatibility?.supportedLine;
  const dashboardBuild =
    [
      builtForLine ? t('facts.dashboardFor', { line: builtForLine }) : '',
      BUILD_COMMIT,
    ]
      .filter(Boolean)
      .join(' · ') || t('facts.notKnown');
  const compatibilityLabel = compatibilityText(
    t,
    compatibility.data?.compatibility ?? info?.compatibility,
  );

  const activeType = isFilterOffered ? attentionType : 'all';
  const shownAttention =
    activeType === 'all'
      ? attention
      : attention.filter((item) => item.type === activeType);

  return (
    <>
      <PageSection>
        {/* Heading and description left; the gateway's status and versions
            right. The masthead's indicator is the health check only, so
            the status the gateway reports for itself is said here. */}
        <Flex
          gap={{ default: 'gapMd' }}
          flexWrap={{ default: 'wrap' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsFlexStart' }}
        >
          <FlexItem>
            <Title headingLevel="h1" className="pf-v6-u-mb-sm">
              {t('title')}
            </Title>
            <Content component="p">{t('description')}</Content>
          </FlexItem>
          <FlexItem>
            <Flex
              direction={{ default: 'column' }}
              gap={{ default: 'gapXs' }}
              alignItems={{ default: 'alignItemsFlexEnd' }}
              data-testid="gateway-facts"
            >
              <FlexItem>
                <Label
                  color={statusColor(status)}
                  icon={statusIcon(status)}
                  data-testid="gateway-status"
                >
                  {status}
                </Label>
              </FlexItem>
              <FlexItem>
                <Content component="small" data-testid="gateway-version">
                  {t('facts.gatewayVersion', { version: gatewayVersion })}
                </Content>
              </FlexItem>
              <FlexItem>
                <Content component="small" data-testid="dashboard-version">
                  {t('facts.dashboard', { build: dashboardBuild })}
                </Content>
              </FlexItem>
              <FlexItem>
                <Content component="small" data-testid="gateway-compatibility">
                  {t('facts.compatibility', { verdict: compatibilityLabel })}
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
          {/* What is waiting; or that the lists are still being read; or,
              once every list has answered, that nothing is. */}
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
                              ? t('attention.filter.all')
                              : t(`attention.types.${activeType}`)}
                          </MenuToggle>
                        )}
                        popperProps={{ position: 'end' }}
                      >
                        <DropdownList>
                          <DropdownItem
                            key="all"
                            value="all"
                            isSelected={activeType === 'all'}
                            data-testid="gateway-attention-type-all"
                          >
                            {t('attention.filter.allCount', {
                              count: attention.length,
                            })}
                          </DropdownItem>
                          {attentionTypes.map((type) => (
                            <DropdownItem
                              key={type}
                              value={type}
                              isSelected={activeType === type}
                              data-testid={`gateway-attention-type-${type}`}
                            >
                              {t('attention.filter.typeCount', {
                                label: t(`attention.types.${type}`),
                                count: attention.filter(
                                  (item) => item.type === type,
                                ).length,
                              })}
                            </DropdownItem>
                          ))}
                        </DropdownList>
                      </Dropdown>
                    ),
                  }}
                >
                  <CardTitle component="h2">
                    {t('attention.title')}{' '}
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
                    sentence saying what is wrong with it, and when it
                    happened (date and time) on the right — after
                    PatternFly's own events card. */}
                <CardBody>
                  <DataList
                    aria-label={t('attention.ariaLabel')}
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
                                      {t(`attention.badges.${item.type}`)}
                                    </Label>
                                  </FlexItem>
                                  <FlexItem>
                                    <Link
                                      to={item.to}
                                      id={`${item.key}-title`}
                                      data-testid={`${item.key}-link`}
                                    >
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
                    {/* What is listed is not all there is while a list is
                        still being read. */}
                    {isLoadingLists && activeType === 'all' && (
                      <AttentionNote
                        id="gateway-attention-loading-label"
                        icon={
                          <Spinner
                            size="md"
                            aria-label={t('attention.loadingMore')}
                            data-testid="gateway-attention-loading"
                          />
                        }
                        text={t('attention.loadingMore')}
                      />
                    )}
                  </DataList>
                </CardBody>
              </Card>
            ) : (
              // The same card, built the same way, so that the row does
              // not change shape when the last thing waiting is dealt with.
              // It says nothing needs attention only once every list has
              // answered: a list still being read could hold anything.
              <Card
                data-testid={
                  isLoadingLists
                    ? 'gateway-attention-pending'
                    : 'gateway-all-clear'
                }
              >
                <CardTitle component="h2">{t('attention.title')}</CardTitle>
                <CardBody>
                  <DataList
                    aria-label={t('attention.ariaLabel')}
                    isCompact
                    gridBreakpoint="none"
                  >
                    {isLoadingLists ? (
                      <AttentionNote
                        id="gateway-attention-loading-label"
                        icon={
                          <Spinner
                            size="md"
                            aria-label={t('attention.loading')}
                            data-testid="gateway-attention-loading"
                          />
                        }
                        text={t('attention.loading')}
                      />
                    ) : (
                      <AttentionNote
                        id="gateway-all-clear-label"
                        icon={
                          <Icon status="success">
                            <CheckCircleIcon />
                          </Icon>
                        }
                        text={t('attention.allClear')}
                      />
                    )}
                  </DataList>
                </CardBody>
              </Card>
            )}
          </GridItem>
          {isEmpty && (
            <GridItem span={12}>
              <Card data-testid="gateway-get-started">
                <CardTitle component="h2">{t('getStarted.title')}</CardTitle>
                <CardBody>
                  <Content component="p">{t('getStarted.intro')}</Content>
                  <ProgressStepper
                    isVertical
                    aria-label={t('getStarted.ariaLabel')}
                  >
                    {/* Done already: the gateway starts with `default`. */}
                    <ProgressStep
                      id="get-started-workspace"
                      titleId="get-started-workspace-title"
                      variant="success"
                      description={t('getStarted.workspaceDetail')}
                    >
                      <Link
                        to="/workspaces"
                        data-testid="get-started-workspace-link"
                      >
                        {t('getStarted.workspace')}
                      </Link>
                    </ProgressStep>
                    {/* Providers are a tab of the workspace's own page. */}
                    <ProgressStep
                      id="get-started-provider"
                      titleId="get-started-provider-title"
                      variant="info"
                      isCurrent
                      description={t('getStarted.providerDetail')}
                    >
                      <Link
                        to="/workspaces/default"
                        data-testid="get-started-provider-link"
                      >
                        {t('getStarted.provider')}
                      </Link>
                    </ProgressStep>
                    <ProgressStep
                      id="get-started-sandbox"
                      titleId="get-started-sandbox-title"
                      variant="pending"
                      description={t('getStarted.sandboxDetail')}
                    >
                      <Link
                        to="/workspaces/default"
                        data-testid="get-started-sandbox-link"
                      >
                        {t('getStarted.sandbox')}
                      </Link>
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
                  {t('drivers.title')}{' '}
                  <Badge isRead data-testid="gateway-drivers-count">
                    {computeDrivers.length}
                  </Badge>
                </CardTitle>
                <Content component="p">{t('drivers.description')}</Content>
              </CardHeader>
              <CardBody>
                <Table aria-label={t('drivers.ariaLabel')} variant="compact">
                  <Thead>
                    <Tr>
                      <Th>{t('drivers.name')}</Th>
                      <Th>{t('drivers.driver')}</Th>
                      <Th>{t('drivers.version')}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {computeDrivers.map((driver) => (
                      <Tr key={driver.name}>
                        <Td dataLabel={t('drivers.name')}>{driver.name}</Td>
                        <Td dataLabel={t('drivers.driver')}>
                          {driver.driverName || '-'}
                        </Td>
                        <Td dataLabel={t('drivers.version')}>
                          {driver.driverVersion || '-'}
                        </Td>
                      </Tr>
                    ))}
                    {computeDrivers.length === 0 && (
                      <Tr>
                        <Td colSpan={3}>{t('drivers.empty')}</Td>
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
                  {t('extensions.title')}{' '}
                  <Badge isRead data-testid="gateway-extensions-count">
                    {extensions.length}
                  </Badge>
                </CardTitle>
                <Content component="p">{t('extensions.description')}</Content>
              </CardHeader>
              <CardBody>
                <Table aria-label={t('extensions.ariaLabel')} variant="compact">
                  <Thead>
                    <Tr>
                      <Th>{t('extensions.name')}</Th>
                      <Th>{t('extensions.kind')}</Th>
                      <Th>{t('extensions.implementation')}</Th>
                      <Th>{t('extensions.protocol')}</Th>
                      <Th>{t('extensions.capabilities')}</Th>
                      <Th>{t('extensions.requires')}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {extensions.map((extension) => (
                      <Tr key={`${extension.kind}/${extension.configuredName}`}>
                        <Td dataLabel={t('extensions.name')}>
                          {extension.configuredName || '-'}
                        </Td>
                        <Td dataLabel={t('extensions.kind')}>
                          {extensionKindLabel(t, extension.kind)}
                        </Td>
                        <Td dataLabel={t('extensions.implementation')}>
                          {[
                            extension.implementationName,
                            extension.implementationVersion,
                          ]
                            .filter(Boolean)
                            .join(' ') || '-'}
                        </Td>
                        <Td dataLabel={t('extensions.protocol')}>
                          {extension.protocolMajor}.{extension.protocolMinor}
                        </Td>
                        <Td dataLabel={t('extensions.capabilities')}>
                          <CapabilityList
                            capabilities={extension.supportedCapabilities}
                          />
                        </Td>
                        <Td dataLabel={t('extensions.requires')}>
                          <CapabilityList
                            capabilities={extension.requiredCapabilities}
                          />
                        </Td>
                      </Tr>
                    ))}
                    {extensions.length === 0 && (
                      <Tr>
                        <Td colSpan={6}>{t('extensions.empty')}</Td>
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
