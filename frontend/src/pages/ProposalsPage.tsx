import {
  Alert,
  Button,
  Content,
  Label,
  PageSection,
  Title,
} from '@patternfly/react-core';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';

import { useFeatureFlags } from '../api/auth';
import {
  useAllWorkspacesDraftSummary,
  useWorkspacesDraftSummaries,
} from '../api/draftSummary';
import { useUserRole } from '../api/rbac';
import { useWorkspaces } from '../api/workspaces';
import ResourceTable from '../components/ResourceTable';
import type { ResourceTableColumn } from '../components/ResourceTable';
import { useI18n } from '../i18n';
import { formatAge } from '../utils/formatters';
import { sandboxPath } from '../utils/workspaceNames';
import type { DraftSandboxSummary } from '../types';

// Where a proposal is acted on: the sandbox's own Proposals tab, which is the
// only place a chunk can be approved. Approving binds each chunk to the
// review token the reviewer's last read of it carried, so a list that has
// only counts cannot approve anything (hard fact 25) — this page leads to the
// inbox, it is not a second one.
const draftsTabPath = (entry: DraftSandboxSummary) =>
  `${sandboxPath(entry.workspace, entry.sandboxName)}?tab=proposals`;

// Known counts first, flagged before the rest, then the most recently
// proposed. A sandbox whose inbox could not be read comes after them: the
// summary is read every DRAFT_SUMMARY_POLL_MS, one inbox read per sandbox, and
// on a busy gateway the ones the BFF runs out of time for would otherwise push
// every known proposal down the page. They are counted in one alert instead.
const byUrgency = (a: DraftSandboxSummary, b: DraftSandboxSummary) => {
  if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? 1 : -1;
  if (a.hasSecurityFlags !== b.hasSecurityFlags) {
    return a.hasSecurityFlags ? -1 : 1;
  }
  return b.latestDraftMs - a.latestDraftMs;
};

type TFunction = ReturnType<typeof useI18n>['t'];

const proposalColumns = (
  t: TFunction,
): ResourceTableColumn<DraftSandboxSummary>[] => [
  {
    title: t('proposals.columns.pending'),
    // The count is the row's one link: what is waiting, leading to where it
    // is decided. An inbox that could not be read is not an inbox with
    // nothing in it, and it leads to the same place — the tab is where the
    // reader finds out what the summary could not say.
    render: (entry) => {
      const value = entry.unavailable ? (
        <Label color="grey" isCompact>
          {t('proposals.unavailableLabel')}
        </Label>
      ) : (
        entry.pendingCount
      );
      // A sandbox the gateway listed without a workspace has no page to
      // lead to (the BFF reports it unavailable without reading it).
      if (!entry.workspace) return value;
      const names = { workspace: entry.workspace, sandbox: entry.sandboxName };
      return (
        <Link
          to={draftsTabPath(entry)}
          aria-label={
            entry.unavailable
              ? t('proposals.unavailableLinkAria', names)
              : t('proposals.pendingLinkAria', {
                  ...names,
                  count: entry.pendingCount,
                })
          }
          data-testid={`proposals-link-${entry.workspace}/${entry.sandboxName}`}
        >
          {value}
        </Link>
      );
    },
  },
  // The two names say which sandbox the row is about; neither is where the
  // row leads. A row with three links in it offers three ways out and says
  // nothing about which one does the thing the page is for.
  {
    title: t('proposals.columns.workspace'),
    modifier: 'nowrap',
    render: (entry) => entry.workspace || '-',
  },
  {
    title: t('proposals.columns.sandbox'),
    modifier: 'nowrap',
    render: (entry) => entry.sandboxName,
  },
  {
    title: t('proposals.columns.security'),
    render: (entry) =>
      entry.hasSecurityFlags ? (
        <Label color="orange" isCompact icon={<ExclamationTriangleIcon />}>
          {t('proposals.flagged')}
        </Label>
      ) : (
        '-'
      ),
  },
  {
    title: t('proposals.columns.latest'),
    render: (entry) =>
      entry.unavailable || !entry.latestDraftMs
        ? '-'
        : formatAge(entry.latestDraftMs),
  },
];

// Every sandbox with a policy rule it has proposed and nobody has decided on
// yet, across the workspaces the signed-in user can read.
//
// Two ways of reading the same thing, because proposals are not a platform
// admin's alone: a platform admin gets the gateway's cross-workspace summary
// in one request, and everyone else gets one request per workspace they are a
// member of, which is what the gateway will answer for them.
const ProposalsPage: React.FC = () => {
  const { t } = useI18n('crossWorkspace');
  const { isPlatformAdmin, isLoading: isRoleLoading } = useUserRole();
  const features = useFeatureFlags();
  const enabled = features.draftPolicy && !isRoleLoading;

  const workspaces = useWorkspaces();
  const workspaceNames = (workspaces.data ?? []).map(
    (workspace) => workspace.metadata.name,
  );

  const acrossWorkspaces = useAllWorkspacesDraftSummary(
    enabled && isPlatformAdmin,
  );
  const perWorkspace = useWorkspacesDraftSummaries(
    workspaceNames,
    enabled && !isPlatformAdmin,
  );
  const summary = isPlatformAdmin ? acrossWorkspaces : perWorkspace;

  // The workspace list is the per-workspace path's first request, so it is
  // part of that path's loading and of its failure. The list, and so its
  // empty state, waits for every read to answer: one built from some of them
  // would say nothing is waiting in the rest.
  const isLoading =
    isRoleLoading ||
    summary.isLoading ||
    (!isPlatformAdmin && workspaces.isLoading);
  const isError =
    summary.isError || (!isPlatformAdmin && workspaces.isError && !isLoading);

  const query = {
    data: isLoading ? undefined : [...summary.items].sort(byUrgency),
    isLoading,
    isError,
    error: summary.error ?? workspaces.error,
    refetch: () => {
      void workspaces.refetch();
      summary.refetch();
    },
  };

  // One workspace that failed is a gap in the list, not the end of it: the
  // rows that did load are still worth showing, and the gap is named.
  const partial =
    !isPlatformAdmin && !isError ? perWorkspace.failedWorkspaces : [];
  const unavailableCount = isLoading
    ? 0
    : summary.items.filter((entry) => entry.unavailable).length;

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          {t('proposals.title')}
        </Title>
        <Content component="p">{t('proposals.description')}</Content>
      </PageSection>
      <PageSection>
        {!features.draftPolicy ? (
          <Alert
            variant="info"
            isInline
            title={t('proposals.disabled.title')}
            data-testid="proposals-disabled"
          >
            {t('proposals.disabled.body')}
          </Alert>
        ) : (
          <>
            {partial.length > 0 && (
              <Alert
                variant="warning"
                isInline
                title={t('proposals.partial.title', { count: partial.length })}
                className="pf-v6-u-mb-md"
                data-testid="proposals-partial"
                actionLinks={
                  <Button variant="link" onClick={() => summary.refetch()}>
                    {t('proposals.partial.retry')}
                  </Button>
                }
              >
                {t('proposals.partial.body', {
                  workspaces: partial.join(', '),
                })}
              </Alert>
            )}
            {unavailableCount > 0 && (
              <Alert
                variant="warning"
                isInline
                title={t('proposals.unavailable.title', {
                  count: unavailableCount,
                })}
                className="pf-v6-u-mb-md"
                data-testid="proposals-unavailable"
              >
                {t('proposals.unavailable.body')}
              </Alert>
            )}
            <ResourceTable
              title={t('proposals.tableTitle')}
              testId="proposals"
              query={query}
              columns={proposalColumns(t)}
              rowKey={(entry) => `${entry.workspace}/${entry.sandboxName}`}
              filterText={(entry) => `${entry.workspace}/${entry.sandboxName}`}
              filterPlaceholder={t('proposals.filterPlaceholder')}
              emptyBody={
                partial.length > 0
                  ? t('proposals.emptyPartial')
                  : t('proposals.empty')
              }
            />
          </>
        )}
      </PageSection>
    </>
  );
};

export default ProposalsPage;
