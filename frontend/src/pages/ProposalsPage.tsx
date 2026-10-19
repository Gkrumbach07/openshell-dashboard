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
import { formatAge } from '../utils/formatters';
import type { DraftSandboxSummary } from '../types';

// Where a proposal is acted on: the sandbox's own Proposals tab, which is the
// only place a chunk can be approved. Approving binds each chunk to the
// review token the reviewer's last read of it carried, so a list that has
// only counts cannot approve anything (hard fact 25) — this page leads to the
// inbox, it is not a second one.
const draftsTabPath = (entry: DraftSandboxSummary) =>
  `/workspaces/${encodeURIComponent(entry.workspace)}/sandboxes/${encodeURIComponent(entry.sandboxName)}?tab=proposals`;

// A sandbox whose inbox could not be read, first: nothing is known about it,
// which is worth more attention than a known count.
const byUrgency = (a: DraftSandboxSummary, b: DraftSandboxSummary) => {
  if (!!a.unavailable !== !!b.unavailable) return a.unavailable ? -1 : 1;
  if (a.hasSecurityFlags !== b.hasSecurityFlags) {
    return a.hasSecurityFlags ? -1 : 1;
  }
  return b.latestDraftMs - a.latestDraftMs;
};

const columns: ResourceTableColumn<DraftSandboxSummary>[] = [
  {
    title: 'Pending',
    // The count is the row's one link: what is waiting, leading to where it
    // is decided. An inbox that could not be read is not an inbox with
    // nothing in it, and it leads to the same place — the tab is where the
    // reader finds out what the summary could not say.
    render: (entry) => (
      <Link
        to={draftsTabPath(entry)}
        data-testid={`proposals-link-${entry.workspace}/${entry.sandboxName}`}
      >
        {entry.unavailable ? (
          <Label color="grey" isCompact>
            Could not be read
          </Label>
        ) : (
          entry.pendingCount
        )}
      </Link>
    ),
  },
  // The two names say which sandbox the row is about; neither is where the
  // row leads. A row with three links in it offers three ways out and says
  // nothing about which one does the thing the page is for.
  {
    title: 'Workspace',
    modifier: 'nowrap',
    render: (entry) => entry.workspace,
  },
  {
    title: 'Sandbox',
    modifier: 'nowrap',
    render: (entry) => entry.sandboxName,
  },
  {
    title: 'Security',
    render: (entry) =>
      entry.hasSecurityFlags ? (
        <Label color="orange" isCompact icon={<ExclamationTriangleIcon />}>
          Flagged
        </Label>
      ) : (
        '-'
      ),
  },
  {
    title: 'Latest',
    render: (entry) =>
      entry.unavailable || !entry.latestDraftMs
        ? '-'
        : formatAge(entry.latestDraftMs),
  },
];

// Every sandbox with a policy rule its agent has proposed and nobody has
// decided on yet, across the workspaces the signed-in user can read.
//
// Two ways of reading the same thing, because proposals are not a platform
// admin's alone: a platform admin gets the gateway's cross-workspace summary
// in one request, and everyone else gets one request per workspace they are a
// member of, which is what the gateway will answer for them.
const ProposalsPage: React.FC = () => {
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
  // part of that path's loading and of its failure.
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

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" className="pf-v6-u-mb-sm">
          Proposals
        </Title>
        <Content component="p">
          Policy rules proposed by the agents running in your sandboxes, and
          waiting for a decision. Select a sandbox to review, edit, approve or
          reject what it has proposed.
        </Content>
      </PageSection>
      <PageSection>
        {!features.draftPolicy ? (
          <Alert
            variant="info"
            isInline
            title="Policy proposals are switched off"
            data-testid="proposals-disabled"
          >
            This dashboard was started with the draft-policy feature disabled,
            so no proposals are read.
          </Alert>
        ) : (
          <>
            {partial.length > 0 && (
              <Alert
                variant="warning"
                isInline
                title={`${partial.length === 1 ? 'A workspace' : `${partial.length} workspaces`} could not be read`}
                className="pf-v6-u-mb-md"
                data-testid="proposals-partial"
                actionLinks={
                  <Button variant="link" onClick={() => summary.refetch()}>
                    Retry
                  </Button>
                }
              >
                No proposals are shown for {partial.join(', ')}. There may be
                some waiting there.
              </Alert>
            )}
            <ResourceTable
              title="Proposals"
              testId="proposals"
              query={query}
              columns={columns}
              rowKey={(entry) => `${entry.workspace}/${entry.sandboxName}`}
              filterText={(entry) => `${entry.workspace}/${entry.sandboxName}`}
              filterPlaceholder="Filter by workspace or sandbox"
              emptyBody="No sandbox you can see has a policy rule waiting for a decision."
            />
          </>
        )}
      </PageSection>
    </>
  );
};

export default ProposalsPage;
