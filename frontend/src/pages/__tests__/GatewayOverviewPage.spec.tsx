import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayOverviewPage from '../GatewayOverviewPage';
import type { GatewayInfo, Sandbox, SandboxCondition } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
  useGatewayCompatibility: jest.fn(),
}));
jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(),
  useAllProviders: jest.fn(),
}));
jest.mock('../../api/draftSummary', () => ({
  useAllWorkspacesDraftSummary: jest.fn(),
}));
jest.mock('../../api/auth', () => ({
  useFeatureFlags: () => ({ draftPolicy: true }),
}));

import { useAllProviders, useAllSandboxes } from '../../api/allWorkspaces';
import { useAllWorkspacesDraftSummary } from '../../api/draftSummary';
import { useGatewayCompatibility, useGatewayInfo } from '../../api/gateway';
import {
  GATEWAY_PAGE_POLL_MS,
  GATEWAY_PAGE_PROVIDERS_POLL_MS,
} from '../../constants';

const mockUseGatewayInfo = useGatewayInfo as jest.Mock;
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;
const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseAllProviders = useAllProviders as jest.Mock;
const mockUseDraftSummary = useAllWorkspacesDraftSummary as jest.Mock;

const answered = (data: unknown) => ({
  isLoading: false,
  isError: false,
  data,
});

const loading = () => ({ isLoading: true, isError: false, data: undefined });

const refused = (message: string) => ({
  isLoading: false,
  isError: true,
  data: undefined,
  error: new Error(message),
});

const proposalsAnswered = (
  items: unknown[] = [],
  totalPending = 0,
): Record<string, unknown> => ({
  ...answered(undefined),
  items,
  totalPending,
});

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

const sandbox = (
  name: string,
  phase: Sandbox['status']['phase'],
  conditions?: SandboxCondition[],
  createdAtMs = minutesAgo(60 * 24 * 30),
): Sandbox => ({
  metadata: {
    id: name,
    name,
    workspace: 'team-a',
    createdAtMs,
    resourceVersion: 1,
  },
  spec: { image: 'example.com/base:latest' },
  status: { phase, currentPolicyVersion: 1, conditions },
});

// A sandbox in error whose Ready condition went False at `atMs`.
const erroredAt = (name: string, atMs: number, message?: string): Sandbox =>
  sandbox(name, 'ERROR', [
    {
      type: 'Ready',
      status: 'False',
      reason: 'ProcessExited',
      message,
      lastTransitionTime: new Date(atMs).toISOString(),
    },
  ]);

const healthy = () =>
  mockUseGatewayInfo.mockReturnValue(
    answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
  );

// Everything the page reads besides the gateway's own info, answered. Each
// test overrides what it is about.
const answerEverythingElse = () => {
  mockUseGatewayCompatibility.mockReturnValue(answered(undefined));
  mockUseAllSandboxes.mockReturnValue(answered([sandbox('worker', 'READY')]));
  mockUseAllProviders.mockReturnValue(answered([{}]));
  mockUseDraftSummary.mockReturnValue(proposalsAnswered());
};

// A new element each time, so that a rerender renders the page again rather
// than bailing out on the same element.
const page = () => (
  <MemoryRouter
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <GatewayOverviewPage />
  </MemoryRouter>
);

const renderPage = () => render(page());

describe('GatewayOverviewPage', () => {
  // Fixed so Timestamp datetime assertions do not drift between the fixture
  // and the expectation.
  const quietProposedAt = minutesAgo(10);
  const flaggedProposedAt = minutesAgo(5);
  const builderErroredAt = minutesAgo(45);

  beforeEach(() => {
    jest.clearAllMocks();
    answerEverythingElse();
  });

  it('shows spinner during loading', () => {
    mockUseGatewayInfo.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });
    renderPage();
    expect(screen.getByLabelText('Loading gateway info')).toBeInTheDocument();
  });

  // The page a platform admin lands on and leaves open: what it reads across
  // workspaces costs more the more sandboxes there are, so it reads at its
  // own pace, not the Sandboxes and Proposals pages'.
  it('reads the lists across workspaces at its own pace', () => {
    healthy();
    renderPage();

    expect(mockUseAllSandboxes).toHaveBeenCalledWith(undefined, {
      refetchInterval: GATEWAY_PAGE_POLL_MS,
    });
    expect(mockUseDraftSummary).toHaveBeenCalledWith(true, {
      refetchInterval: GATEWAY_PAGE_POLL_MS,
    });
    expect(mockUseAllProviders).toHaveBeenCalledWith({
      refetchInterval: GATEWAY_PAGE_PROVIDERS_POLL_MS,
    });
  });

  it('shows error alert on fetch failure', () => {
    mockUseGatewayInfo.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Connection refused'),
      refetch: jest.fn(),
    });
    renderPage();
    expect(
      screen.getByText('Cannot reach the OpenShell gateway'),
    ).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  // One strip: the status the gateway reports for itself, both versions and
  // the verdict that relates them. The masthead's indicator is the health
  // check only, so DEGRADED would be said nowhere else.
  it('states the status, both versions and the verdict together', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.1.2',
      computeDrivers: [
        { name: 'local-podman', driverName: 'podman', driverVersion: '5.2.0' },
      ],
    };
    mockUseGatewayInfo.mockReturnValue(answered(info));
    mockUseGatewayCompatibility.mockReturnValue(
      answered({
        gatewayVersion: '0.1.2',
        compatibility: {
          status: 'supported',
          supportedLine: '0.1',
        },
      }),
    );
    renderPage();

    const strip = screen.getByTestId('gateway-facts');
    expect(within(strip).getByTestId('gateway-status')).toHaveTextContent(
      'HEALTHY',
    );
    expect(strip).toHaveTextContent(
      'HEALTHYGateway version: 0.1.2Dashboard: for 0.1.xCompatibility: Supported (0.1.x)',
    );
    expect(within(strip).getByTestId('gateway-version')).toHaveTextContent(
      'Gateway version: 0.1.2',
    );
    expect(within(strip).getByTestId('dashboard-version')).toHaveTextContent(
      'Dashboard: for 0.1.x',
    );
    expect(
      within(strip).getByTestId('gateway-compatibility'),
    ).toHaveTextContent('Compatibility: Supported (0.1.x)');
  });

  it('shows a degraded gateway as degraded', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'DEGRADED', gatewayVersion: '0.1.2' }),
    );
    renderPage();

    const status = screen.getByTestId('gateway-status');
    expect(status).toHaveTextContent('DEGRADED');
    expect(status).toHaveClass('pf-m-orange');
  });

  it('says so when there is no verdict to report', () => {
    healthy();
    renderPage();

    expect(screen.getByTestId('gateway-compatibility')).toHaveTextContent(
      'Not known',
    );
  });

  // A gateway starts with a `default` workspace, so having workspaces is not
  // having been used, and the first step is already done.
  it('walks through getting started on an empty gateway', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(answered([]));
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    const started = within(screen.getByTestId('gateway-get-started'));
    expect(
      started.getByRole('heading', { name: 'Get started' }),
    ).toBeInTheDocument();
    expect(started.getByTestId('get-started-workspace-link')).toHaveAttribute(
      'href',
      '/workspaces',
    );
    expect(
      started.getByText(/starts with a workspace called default/),
    ).toBeInTheDocument();
    expect(started.getByTestId('get-started-provider-link')).toHaveAttribute(
      'href',
      '/workspaces/default',
    );
    expect(started.getByTestId('get-started-sandbox-link')).toHaveAttribute(
      'href',
      '/workspaces/default',
    );
    // The workspace step is done; adding a provider is the current one.
    expect(
      started
        .getByTestId('get-started-workspace-link')
        .closest('.pf-v6-c-progress-stepper__step'),
    ).toHaveClass('pf-m-success');
    expect(
      started
        .getByTestId('get-started-provider-link')
        .closest('.pf-v6-c-progress-stepper__step'),
    ).toHaveClass('pf-m-current');
    // Nothing about an agent: there is none.
    expect(screen.getByTestId('gateway-get-started')).not.toHaveTextContent(
      /agent/i,
    );
  });

  // Counts that are not known are not zeros.
  it('does not offer getting started while the counts are not known', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(loading());
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    expect(screen.queryByTestId('gateway-get-started')).not.toBeInTheDocument();
  });

  it('says nothing needs attention once every list has answered', () => {
    healthy();
    renderPage();

    expect(screen.queryByTestId('gateway-attention')).not.toBeInTheDocument();
    expect(screen.getByTestId('gateway-all-clear')).toHaveTextContent(
      'Nothing needs attention',
    );
  });

  // A list still being read could hold anything, so the card says it is
  // reading rather than that nothing is waiting.
  it.each([
    ['sandboxes', () => mockUseAllSandboxes.mockReturnValue(loading())],
    ['providers', () => mockUseAllProviders.mockReturnValue(loading())],
    [
      'proposals',
      () =>
        mockUseDraftSummary.mockReturnValue({
          ...proposalsAnswered(),
          isLoading: true,
        }),
    ],
  ])('shows a loading state while the %s are read', (_list, arrange) => {
    healthy();
    arrange();
    renderPage();

    expect(screen.queryByTestId('gateway-all-clear')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('gateway-attention-loading')).toHaveAttribute(
      'aria-label',
      'Reading what needs attention',
    );
  });

  it('says the rest is still being read beside what is already known', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([erroredAt('builder', builderErroredAt)]),
    );
    mockUseAllProviders.mockReturnValue(loading());
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    expect(card.getByText('team-a/builder')).toBeInTheDocument();
    expect(card.getByTestId('gateway-attention-loading')).toBeInTheDocument();
    expect(card.getByTestId('gateway-attention-count')).toHaveTextContent('1');
  });

  // A refusal (403 for anybody but a platform admin) or an unavailable BFF
  // is never shown as nothing to do.
  it.each([
    ['sandboxes', 'Sandboxes could not be read', '/sandboxes'],
    ['providers', 'Providers could not be read', '/all-workspaces'],
    ['proposals', 'Proposals could not be read', '/proposals'],
  ])('raises a row when the %s cannot be read', (list, text, href) => {
    healthy();
    if (list === 'sandboxes') {
      mockUseAllSandboxes.mockReturnValue(refused('forbidden'));
    } else if (list === 'providers') {
      mockUseAllProviders.mockReturnValue(refused('forbidden'));
    } else {
      mockUseDraftSummary.mockReturnValue({
        ...refused('forbidden'),
        items: [],
        totalPending: 0,
      });
    }
    renderPage();

    expect(screen.queryByTestId('gateway-all-clear')).not.toBeInTheDocument();
    const card = within(screen.getByTestId('gateway-attention'));
    expect(card.getByTestId(`unread-${list}-link`)).toHaveTextContent(text);
    expect(card.getByTestId(`unread-${list}-link`)).toHaveAttribute(
      'href',
      href,
    );
    expect(card.getByText('forbidden')).toBeInTheDocument();
    expect(card.getByText('Not read')).toBeInTheDocument();
  });

  it('raises a sandbox in error and a gateway with no providers', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([
        sandbox('worker', 'READY'),
        erroredAt('builder', builderErroredAt),
      ]),
    );
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    const attention = within(screen.getByTestId('gateway-attention'));
    // The sandbox in error is named as workspace/sandbox and leads to its
    // own log, which is the only thing that says why it is in error. A count
    // would have led to a list the reader then has to search.
    expect(
      attention.getByTestId('errored-team-a/builder-link'),
    ).toHaveAttribute('href', '/workspaces/team-a/sandboxes/builder?tab=logs');
    expect(attention.getByText(/Provisioning failed/)).toBeInTheDocument();
    // When the error landed is when the condition last changed.
    expect(
      attention.getByTestId('errored-team-a/builder-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(builderErroredAt).toISOString());
    // The badge beside it says which of the card's kinds it is.
    expect(attention.getByText('Sandbox error')).toBeInTheDocument();
    expect(attention.getByTestId('no-providers-link')).toHaveTextContent(
      'No providers',
    );
    expect(
      attention.getByText(/no credentials to reach a model/),
    ).toBeInTheDocument();
    expect(attention.getByTestId('no-providers-age')).toHaveTextContent('-');
    expect(screen.queryByTestId('gateway-all-clear')).not.toBeInTheDocument();
  });

  // The sandbox's creation time is not when it went into error.
  it('shows no time for an error without a transition time', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('builder', 'ERROR')]),
    );
    renderPage();

    const age = screen.getByTestId('errored-team-a/builder-age');
    expect(age.querySelector('time')).toBeNull();
    expect(age).toHaveTextContent('-');
  });

  // The Ready condition that is False says why; a True condition that merely
  // carries a reason does not.
  it('explains the error with the False Ready condition', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([
        sandbox('builder', 'ERROR', [
          {
            type: 'Scheduled',
            status: 'True',
            reason: 'Scheduled',
            message: 'Placed on a node',
            lastTransitionTime: new Date(minutesAgo(90)).toISOString(),
          },
          {
            type: 'Ready',
            status: 'False',
            reason: 'ImagePullFailed',
            message: 'image example.com/base:latest not found',
            lastTransitionTime: new Date(builderErroredAt).toISOString(),
          },
        ]),
      ]),
    );
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    expect(
      card.getByText('image example.com/base:latest not found'),
    ).toBeInTheDocument();
    expect(card.queryByText('Placed on a node')).not.toBeInTheDocument();
    expect(
      card.getByTestId('errored-team-a/builder-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(builderErroredAt).toISOString());
  });

  // The newest four errors are named; the rest are one line leading to the
  // list of every sandbox.
  it('names the newest errors first and counts the rest', () => {
    healthy();
    const ages = [50, 10, 30, 5, 40, 20];
    mockUseAllSandboxes.mockReturnValue(
      answered(ages.map((age) => erroredAt(`s-${age}`, minutesAgo(age)))),
    );
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    expect(card.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'team-a/s-5',
      'team-a/s-10',
      'team-a/s-20',
      'team-a/s-30',
      '2 more sandboxes in error',
    ]);
    expect(card.getByTestId('errored-more-link')).toHaveAttribute(
      'href',
      '/sandboxes',
    );
  });

  // A rule proposed for a sandbox holds it up until somebody decides on it,
  // so it leads the list, and each one leads to the inbox where that
  // decision is made — approving binds a chunk to the review token of the
  // reviewer's own last read of it (hard fact 25).
  it('names every sandbox with rules waiting, ahead of the errors', () => {
    healthy();
    mockUseDraftSummary.mockReturnValue(
      proposalsAnswered(
        [
          {
            workspace: 'team-a',
            sandboxName: 'quiet',
            pendingCount: 1,
            hasSecurityFlags: false,
            // Same instant the sandbox Proposals tab shows in Proposed.
            latestDraftMs: quietProposedAt,
            latestRationale:
              'The sandbox attempted to install packages from PyPI. Allowing access to pypi.org enables pip install.',
          },
          {
            workspace: 'team-b',
            sandboxName: 'flagged',
            pendingCount: 2,
            hasSecurityFlags: true,
            latestDraftMs: flaggedProposedAt,
            latestRationale: 'Model weights download from Hugging Face Hub.',
          },
        ],
        3,
      ),
    );
    mockUseAllSandboxes.mockReturnValue(
      answered([
        sandbox('worker', 'READY'),
        erroredAt('builder', builderErroredAt),
      ]),
    );
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    const rows = card.getAllByRole('link');
    // The one the prover flagged leads, whatever its age.
    expect(rows[0]).toHaveTextContent('team-b/flagged');
    expect(rows[0]).toHaveAttribute(
      'href',
      '/workspaces/team-b/sandboxes/flagged?tab=proposals',
    );
    expect(rows[1]).toHaveTextContent('team-a/quiet');
    expect(rows[2]).toHaveTextContent('team-a/builder');
    // Each proposal row carries the newest chunk's rationale under the link.
    expect(
      card.getByText('Model weights download from Hugging Face Hub.'),
    ).toBeInTheDocument();
    expect(
      card.getByText(
        'The sandbox attempted to install packages from PyPI. Allowing access to pypi.org enables pip install.',
      ),
    ).toBeInTheDocument();
    // Proposal times are the Proposed column's createdAt of the newest chunk.
    expect(
      card.getByTestId('proposals-team-b/flagged-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(flaggedProposedAt).toISOString());
    expect(
      card.getByTestId('proposals-team-a/quiet-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(quietProposedAt).toISOString());
    // Each row is badged with its kind: the two proposals, then the error.
    expect(card.getAllByText('Proposal')).toHaveLength(2);
    expect(card.getByText('Sandbox error')).toBeInTheDocument();
  });

  // An inbox that could not be read leads: what is in it is not known.
  it('raises a sandbox whose proposal inbox could not be read', () => {
    healthy();
    mockUseDraftSummary.mockReturnValue(
      proposalsAnswered([
        {
          workspace: 'team-a',
          sandboxName: 'counted',
          pendingCount: 2,
          hasSecurityFlags: false,
          latestDraftMs: quietProposedAt,
        },
        {
          workspace: 'team-b',
          sandboxName: 'unread',
          pendingCount: 0,
          hasSecurityFlags: false,
          latestDraftMs: 0,
          unavailable: true,
        },
      ]),
    );
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    const rows = card.getAllByRole('link');
    expect(rows[0]).toHaveTextContent('team-b/unread');
    expect(
      card.getByText(/Its proposal inbox could not be read/),
    ).toBeInTheDocument();
    expect(card.getByTestId('proposals-team-b/unread-age')).toHaveTextContent(
      '-',
    );
    expect(rows[1]).toHaveTextContent('team-a/counted');
    expect(
      card.getByText('2 policy rules waiting for a decision.'),
    ).toBeInTheDocument();
  });

  // A summary that carries a total but no sandboxes still says so, and all
  // it can do is lead to the page that lists them.
  it('falls back to the total when no sandbox is named', () => {
    healthy();
    mockUseDraftSummary.mockReturnValue(proposalsAnswered([], 3));
    renderPage();

    const card = screen.getByTestId('gateway-attention');
    const rows = within(card).getAllByRole('link');
    expect(rows[0]).toHaveTextContent('3 policy rules waiting for a decision');
    expect(rows[0]).toHaveAttribute('href', '/proposals');
    expect(card).not.toHaveTextContent(/agent/i);
  });

  // Only the kinds that are waiting are offered, and choosing one leaves the
  // other kinds' lines out.
  it('filters the card by the kind of thing waiting', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('worker', 'READY'), sandbox('builder', 'ERROR')]),
    );
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    const card = within(screen.getByTestId('gateway-attention'));
    expect(card.getByTestId('gateway-attention-type')).toHaveTextContent(
      'All types',
    );
    // The badge counts the rows under the heading, so it follows the filter.
    expect(card.getByTestId('gateway-attention-count')).toHaveTextContent('2');
    // The menu itself is a popper, outside the card.
    fireEvent.click(card.getByTestId('gateway-attention-type'));
    const menu = within(screen.getByRole('menu'));
    // Nothing is proposed, so Proposals is not offered.
    expect(
      screen.queryByTestId('gateway-attention-type-proposals'),
    ).not.toBeInTheDocument();
    expect(menu.getByText('All types (2)')).toBeInTheDocument();
    expect(
      screen.getByTestId('gateway-attention-type-errors'),
    ).toHaveTextContent('Sandbox errors (1)');
    fireEvent.click(menu.getByText('Sandbox errors (1)'));

    expect(card.getByText('team-a/builder')).toBeInTheDocument();
    expect(card.queryByText(/^No providers/)).not.toBeInTheDocument();
    expect(card.getByTestId('gateway-attention-count')).toHaveTextContent('1');
  });

  // A filter whose kind has gone is dropped, not kept to come back by itself
  // the next time something of that kind turns up.
  it('drops a filter whose kind is no longer waiting', () => {
    healthy();
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('builder', 'ERROR')]),
    );
    mockUseAllProviders.mockReturnValue(answered([]));
    const { rerender } = renderPage();

    fireEvent.click(screen.getByTestId('gateway-attention-type'));
    // The test id is on the item; the menu item inside it is what is chosen.
    fireEvent.click(
      within(screen.getByTestId('gateway-attention-type-errors')).getByRole(
        'menuitem',
      ),
    );
    expect(screen.getByTestId('gateway-attention-type')).toHaveTextContent(
      'Sandbox errors',
    );

    // The error is dealt with: only the missing providers are left.
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('builder', 'READY')]),
    );
    rerender(page());
    expect(screen.getByTestId('gateway-attention-type')).toHaveTextContent(
      'All types',
    );

    // A new error does not bring the old filter back.
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('builder', 'ERROR')]),
    );
    rerender(page());
    expect(screen.getByTestId('gateway-attention-type')).toHaveTextContent(
      'All types',
    );
    expect(screen.getByTestId('no-providers-link')).toBeInTheDocument();
    expect(screen.getByTestId('gateway-attention-count')).toHaveTextContent(
      '2',
    );
  });

  it('displays compute drivers table', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.0.92',
      computeDrivers: [
        { name: 'local-podman', driverName: 'podman', driverVersion: '5.2.0' },
        {
          name: 'k8s-cluster',
          driverName: 'kubernetes',
          driverVersion: '1.30',
        },
      ],
    };
    mockUseGatewayInfo.mockReturnValue(answered(info));
    renderPage();
    expect(screen.getByTestId('gateway-drivers-count')).toHaveTextContent('2');
    expect(screen.getByTestId('gateway-drivers-card')).toBeInTheDocument();
    expect(screen.getByText('local-podman')).toBeInTheDocument();
    expect(screen.getByText('k8s-cluster')).toBeInTheDocument();
  });

  // What `openshell gateway info` lists under "Extensions": the configured
  // name and kind, the implementation with its version and protocol, what it
  // can do and what it needs from the gateway.
  it('displays the extensions the gateway negotiated', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.1.2',
      computeDrivers: [{ name: 'podman', driverName: 'podman' }],
      extensions: [
        {
          kind: 'COMPUTE_DRIVER',
          configuredName: 'podman',
          implementationName: 'example-driver',
          implementationVersion: '0.1.2',
          protocolMajor: 1,
          protocolMinor: 3,
          supportedCapabilities: ['capability-a', 'capability-b'],
          requiredCapabilities: ['gateway-capability'],
        },
        {
          kind: 'CREDENTIAL_DRIVER',
          configuredName: 'vault',
          protocolMajor: 2,
          protocolMinor: 0,
        },
      ],
    };
    mockUseGatewayInfo.mockReturnValue(answered(info));
    renderPage();

    expect(screen.getByTestId('gateway-extensions-count')).toHaveTextContent(
      '2',
    );

    const card = within(screen.getByTestId('gateway-extensions-card'));
    expect(
      card.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'Name',
      'Kind',
      'Implementation',
      'Protocol',
      'Capabilities',
      'Requires from gateway',
    ]);
    const rows = card
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      [
        'podman',
        'Compute driver',
        'example-driver 0.1.2',
        '1.3',
        'capability-acapability-b',
        'gateway-capability',
      ],
      ['vault', 'Credential driver', '-', '2.0', '-', '-'],
    ]);
  });

  it('names every extension kind, and shows one it does not know as sent', () => {
    const kinds = [
      ['COMPUTE_DRIVER', 'Compute driver'],
      ['CREDENTIAL_DRIVER', 'Credential driver'],
      ['GATEWAY_INTERCEPTOR', 'Gateway interceptor'],
      ['SUPERVISOR_MIDDLEWARE', 'Supervisor middleware'],
      ['UNSPECIFIED', 'Unspecified'],
      ['SOMETHING_NEW', 'SOMETHING_NEW'],
    ];
    mockUseGatewayInfo.mockReturnValue(
      answered({
        status: 'HEALTHY',
        gatewayVersion: '0.1.2',
        computeDrivers: [],
        extensions: kinds.map(([kind], index) => ({
          kind,
          configuredName: `extension-${index}`,
          protocolMajor: 1,
          protocolMinor: 0,
        })),
      }),
    );
    renderPage();

    for (const [index, [, label]] of kinds.entries()) {
      const row = screen.getByText(`extension-${index}`).closest('tr');
      expect(row).toHaveTextContent(label);
    }
  });

  // A gateway without extensions, and a response without the field, both
  // leave the card saying so instead of breaking the page.
  it.each([
    ['an empty list', []],
    ['no extensions field', undefined],
  ])('shows that none were reported for %s', (_name, extensions) => {
    mockUseGatewayInfo.mockReturnValue(
      answered({
        status: 'HEALTHY',
        gatewayVersion: '0.1.0',
        computeDrivers: [],
        extensions,
      }),
    );
    renderPage();

    expect(screen.getByTestId('gateway-extensions-count')).toHaveTextContent(
      '0',
    );
    expect(
      within(screen.getByTestId('gateway-extensions-card')).getByText(
        'No extensions reported',
      ),
    ).toBeInTheDocument();
  });

  it('shows empty driver message when none reported', () => {
    const info: GatewayInfo = {
      status: 'HEALTHY',
      gatewayVersion: '0.0.92',
      computeDrivers: [],
    };
    mockUseGatewayInfo.mockReturnValue(answered(info));
    renderPage();
    expect(screen.getByText('No compute drivers reported')).toBeInTheDocument();
  });
});
