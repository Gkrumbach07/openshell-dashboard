import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayOverviewPage from '../GatewayOverviewPage';
import type { GatewayInfo, Sandbox } from '../../types';

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: jest.fn(),
  useGatewayCompatibility: jest.fn(),
}));
jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(),
  useAllProviders: jest.fn(),
}));
jest.mock('../../api/policy', () => ({ useGlobalPolicy: jest.fn() }));
jest.mock('../../api/settings', () => ({ useGlobalSettings: jest.fn() }));
jest.mock('../../api/draftSummary', () => ({
  useAllWorkspacesDraftSummary: jest.fn(),
}));
jest.mock('../../api/auth', () => ({
  useFeatureFlags: () => ({
    globalPolicy: true,
    settings: true,
    draftPolicy: true,
  }),
}));

import { useAllProviders, useAllSandboxes } from '../../api/allWorkspaces';
import { useAllWorkspacesDraftSummary } from '../../api/draftSummary';
import { useGatewayCompatibility, useGatewayInfo } from '../../api/gateway';
import { useGlobalPolicy } from '../../api/policy';
import { useGlobalSettings } from '../../api/settings';

const mockUseGatewayInfo = useGatewayInfo as jest.Mock;
const mockUseGatewayCompatibility = useGatewayCompatibility as jest.Mock;
const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseAllProviders = useAllProviders as jest.Mock;
const mockUseGlobalPolicy = useGlobalPolicy as jest.Mock;
const mockUseGlobalSettings = useGlobalSettings as jest.Mock;
const mockUseDraftSummary = useAllWorkspacesDraftSummary as jest.Mock;

const answered = (data: unknown) => ({
  isLoading: false,
  isError: false,
  data,
});

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

const sandbox = (
  name: string,
  phase: Sandbox['status']['phase'],
  createdAtMs = minutesAgo(45),
): Sandbox => ({
  metadata: {
    id: name,
    name,
    workspace: 'team-a',
    createdAtMs,
    resourceVersion: 1,
  },
  spec: { image: 'example.com/base:latest' },
  status: { phase, currentPolicyVersion: 1 },
});

// Everything the page reads besides the gateway's own info, answered. Each
// test overrides what it is about.
const answerEverythingElse = () => {
  mockUseGatewayCompatibility.mockReturnValue(answered(undefined));
  mockUseAllSandboxes.mockReturnValue(answered([sandbox('agent', 'READY')]));
  mockUseAllProviders.mockReturnValue(answered([{}]));
  mockUseGlobalPolicy.mockReturnValue(answered({ activeVersion: 0 }));
  mockUseGlobalSettings.mockReturnValue(answered({ settings: [] }));
  mockUseDraftSummary.mockReturnValue({
    ...answered(undefined),
    items: [],
    totalPending: 0,
  });
};

const renderPage = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <GatewayOverviewPage />
    </MemoryRouter>,
  );

describe('GatewayOverviewPage', () => {
  // Fixed so Timestamp datetime assertions do not drift between the fixture
  // and the expectation.
  const quietProposedAt = minutesAgo(10);
  const flaggedProposedAt = minutesAgo(5);
  const builderCreatedAt = minutesAgo(45);

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

  // One strip, not a card each: both versions and the verdict that relates
  // them. The gateway's health is the masthead's, on every page.
  it('states both versions and the verdict together, and not the health', () => {
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

    const strip = screen.getByTestId('gateway-status-card');
    expect(within(strip).queryByText('HEALTHY')).not.toBeInTheDocument();
    expect(strip).toHaveTextContent(
      'Gateway version: 0.1.2Dashboard: for 0.1.xCompatibility: Supported (0.1.x)',
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

  it('says so when there is no verdict to report', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    renderPage();

    expect(screen.getByTestId('gateway-compatibility')).toHaveTextContent(
      'Not known',
    );
  });

  // A gateway starts with a `default` workspace, so having workspaces is not
  // having been used.
  it('walks through getting started on an empty gateway', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    mockUseAllSandboxes.mockReturnValue(answered([]));
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    const started = within(screen.getByTestId('gateway-get-started'));
    expect(started.getByText('Create a workspace')).toBeInTheDocument();
    expect(started.getByText('Add a provider')).toBeInTheDocument();
    expect(started.getByText('Create a sandbox')).toBeInTheDocument();
  });

  it('raises what is worth doing something about, and nothing when all is well', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    renderPage();
    expect(screen.queryByTestId('gateway-attention')).not.toBeInTheDocument();
    // The row under the versions says so rather than going blank.
    expect(screen.getByTestId('gateway-all-clear')).toHaveTextContent(
      'Nothing needs attention',
    );

    mockUseAllSandboxes.mockReturnValue(
      answered([
        sandbox('agent', 'READY'),
        sandbox('builder', 'ERROR', builderCreatedAt),
      ]),
    );
    mockUseAllProviders.mockReturnValue(answered([]));
    renderPage();

    const attention = within(screen.getAllByTestId('gateway-attention')[0]);
    // The sandbox in error is named as workspace/sandbox and leads to its
    // own log, which is the only thing that says why it is in error. A count
    // would have led to a list the reader then has to search.
    expect(attention.getByText('team-a/builder')).toHaveAttribute(
      'href',
      '/workspaces/team-a/sandboxes/builder?tab=logs',
    );
    expect(attention.getByText(/Provisioning failed/)).toBeInTheDocument();
    expect(
      attention.getByTestId('errored-team-a/builder-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(builderCreatedAt).toISOString());
    // The badge beside it says which of the card's kinds it is.
    expect(attention.getByText('Sandbox error')).toBeInTheDocument();
    expect(
      attention.getByText(/^No providers/, { selector: 'a' }),
    ).toBeInTheDocument();
    expect(
      attention.getByText(/no credentials to reach a model/),
    ).toBeInTheDocument();
    expect(attention.getByTestId('no-providers-age')).toHaveTextContent('-');
    // The second render is the one with something waiting; the all-clear
    // panel belongs to the first, which is still mounted beside it.
    expect(screen.getAllByTestId('gateway-all-clear')).toHaveLength(1);
  });

  // A rule an agent proposed is a sandbox held up until somebody decides on
  // it, so it leads the list, and each one leads to the inbox where that
  // decision is made — approving binds a chunk to the review token of the
  // reviewer's own last read of it (hard fact 25).
  it('names every sandbox with rules waiting, ahead of the errors', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    mockUseDraftSummary.mockReturnValue({
      ...answered(undefined),
      items: [
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
      totalPending: 3,
    });
    mockUseAllSandboxes.mockReturnValue(
      answered([
        sandbox('agent', 'READY'),
        sandbox('builder', 'ERROR', builderCreatedAt),
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
    expect(
      card.getByTestId('errored-team-a/builder-age').querySelector('time'),
    ).toHaveAttribute('datetime', new Date(builderCreatedAt).toISOString());
    // Each row is badged with its kind: the two proposals, then the error.
    expect(card.getAllByText('Proposal')).toHaveLength(2);
    expect(card.getByText('Sandbox error')).toBeInTheDocument();
  });

  // A summary that carries a total but no sandboxes still says so, and all
  // it can do is lead to the page that lists them.
  it('falls back to the total when no sandbox is named', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    mockUseDraftSummary.mockReturnValue({
      ...answered(undefined),
      items: [],
      totalPending: 3,
    });
    renderPage();

    const rows = within(screen.getByTestId('gateway-attention')).getAllByRole(
      'link',
    );
    expect(rows[0]).toHaveTextContent('3 policy rules waiting for a decision');
    expect(rows[0]).toHaveAttribute('href', '/proposals');
  });

  // Only the kinds that are waiting are offered, and choosing one leaves the
  // other kinds' lines out.
  it('filters the card by the kind of thing waiting', () => {
    mockUseGatewayInfo.mockReturnValue(
      answered({ status: 'HEALTHY', gatewayVersion: '0.1.2' }),
    );
    mockUseAllSandboxes.mockReturnValue(
      answered([sandbox('agent', 'READY'), sandbox('builder', 'ERROR')]),
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
    expect(menu.queryByText(/^Proposals/)).not.toBeInTheDocument();
    expect(menu.getByText('All types (2)')).toBeInTheDocument();
    fireEvent.click(menu.getByText('Sandbox errors (1)'));

    expect(card.getByText('team-a/builder')).toBeInTheDocument();
    expect(card.queryByText(/^No providers/)).not.toBeInTheDocument();
    expect(card.getByTestId('gateway-attention-count')).toHaveTextContent('1');
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
