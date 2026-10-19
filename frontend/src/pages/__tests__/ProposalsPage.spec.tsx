import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ProposalsPage from '../ProposalsPage';
import type { DraftSandboxSummary, Workspace } from '../../types';

let mockIsPlatformAdmin = true;
let mockDraftPolicy = true;

jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isLoading: false,
  }),
}));
jest.mock('../../api/auth', () => ({
  useFeatureFlags: () => ({ draftPolicy: mockDraftPolicy }),
}));
jest.mock('../../api/workspaces', () => ({ useWorkspaces: jest.fn() }));
jest.mock('../../api/draftSummary', () => ({
  useAllWorkspacesDraftSummary: jest.fn(),
  useWorkspacesDraftSummaries: jest.fn(),
}));

import {
  useAllWorkspacesDraftSummary,
  useWorkspacesDraftSummaries,
} from '../../api/draftSummary';
import { useWorkspaces } from '../../api/workspaces';

const mockUseWorkspaces = useWorkspaces as jest.Mock;
const mockUseAcrossWorkspaces = useAllWorkspacesDraftSummary as jest.Mock;
const mockUsePerWorkspace = useWorkspacesDraftSummaries as jest.Mock;

const workspace = (name: string): Workspace => ({
  metadata: { id: name, name, createdAtMs: 0, resourceVersion: 1 },
  phase: 'ACTIVE',
});

const entry = (
  partial: Partial<DraftSandboxSummary> &
    Pick<DraftSandboxSummary, 'workspace' | 'sandboxName'>,
): DraftSandboxSummary => ({
  pendingCount: 0,
  hasSecurityFlags: false,
  latestDraftMs: 0,
  ...partial,
});

// What either read answers, in the shape both hooks return.
const summary = (
  items: DraftSandboxSummary[],
  extra: Record<string, unknown> = {},
) => ({
  items,
  totalPending: items.reduce((sum, item) => sum + item.pendingCount, 0),
  isLoading: false,
  isError: false,
  error: undefined,
  failedWorkspaces: [],
  refetch: jest.fn(),
  ...extra,
});

const renderPage = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ProposalsPage />
    </MemoryRouter>,
  );

const rows = () =>
  within(screen.getByTestId('proposals-table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

describe('ProposalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = true;
    mockDraftPolicy = true;
    mockUseWorkspaces.mockReturnValue({
      data: [workspace('team-a'), workspace('team-b')],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseAcrossWorkspaces.mockReturnValue(summary([]));
    mockUsePerWorkspace.mockReturnValue(summary([]));
  });

  // The cross-workspace summary is one request, and the gateway answers it
  // for a platform admin only.
  it('reads every workspace at once for a platform admin', () => {
    mockUseAcrossWorkspaces.mockReturnValue(
      summary([
        entry({ workspace: 'team-a', sandboxName: 'agent', pendingCount: 1 }),
      ]),
    );
    renderPage();

    expect(mockUseAcrossWorkspaces).toHaveBeenCalledWith(true);
    expect(mockUsePerWorkspace).toHaveBeenCalledWith(
      ['team-a', 'team-b'],
      false,
    );
    expect(rows()).toHaveLength(1);
  });

  // Proposals are a sandbox's, not the platform's: without the rollup the
  // page asks each workspace the user is a member of.
  it('reads one workspace at a time for everyone else', () => {
    mockIsPlatformAdmin = false;
    mockUsePerWorkspace.mockReturnValue(
      summary([
        entry({ workspace: 'team-b', sandboxName: 'agent', pendingCount: 2 }),
      ]),
    );
    renderPage();

    expect(mockUseAcrossWorkspaces).toHaveBeenCalledWith(false);
    expect(mockUsePerWorkspace).toHaveBeenCalledWith(
      ['team-a', 'team-b'],
      true,
    );
    expect(rows()).toEqual([['2', 'team-b', 'agent', '-', '-']]);
  });

  // Unreadable first, then flagged, then the most recently proposed.
  it('puts what is most urgent at the top', () => {
    mockUseAcrossWorkspaces.mockReturnValue(
      summary([
        entry({
          workspace: 'team-a',
          sandboxName: 'quiet',
          pendingCount: 1,
          latestDraftMs: 1_000,
        }),
        entry({
          workspace: 'team-b',
          sandboxName: 'flagged',
          pendingCount: 2,
          hasSecurityFlags: true,
          latestDraftMs: 500,
        }),
        entry({
          workspace: 'team-b',
          sandboxName: 'unknown',
          unavailable: true,
        }),
      ]),
    );
    renderPage();

    // Sandbox name is the third column (after Pending and Workspace).
    expect(rows().map((cells) => cells[2])).toEqual([
      'unknown',
      'flagged',
      'quiet',
    ]);
  });

  // A sandbox whose inbox could not be read has an unknown number of
  // proposals waiting, which is not none.
  it('never shows a sandbox it could not read as empty', () => {
    mockUseAcrossWorkspaces.mockReturnValue(
      summary([
        entry({
          workspace: 'team-a',
          sandboxName: 'agent',
          unavailable: true,
        }),
      ]),
    );
    renderPage();

    expect(rows()).toEqual([
      ['Could not be read', 'team-a', 'agent', '-', '-'],
    ]);
  });

  // Approving binds a chunk to the review token of the read it came from, so
  // this page leads to the sandbox's own inbox rather than being a second one.
  it('leads to the sandbox the rules were proposed in', () => {
    mockUseAcrossWorkspaces.mockReturnValue(
      summary([
        entry({ workspace: 'team-a', sandboxName: 'agent', pendingCount: 1 }),
      ]),
    );
    renderPage();

    const link = screen.getByTestId('proposals-link-team-a/agent');
    expect(link).toHaveAttribute(
      'href',
      '/workspaces/team-a/sandboxes/agent?tab=proposals',
    );
    // The count is the row's one link. The two names beside it say which
    // sandbox the row is about and lead nowhere.
    expect(link).toHaveTextContent('1');
    expect(screen.getAllByRole('link')).toEqual([link]);
  });

  // One workspace that failed is a gap in the list, not the end of it.
  it('names the workspaces it could not read, and shows the rest', () => {
    mockIsPlatformAdmin = false;
    mockUsePerWorkspace.mockReturnValue(
      summary(
        [entry({ workspace: 'team-a', sandboxName: 'agent', pendingCount: 1 })],
        { failedWorkspaces: ['team-b'] },
      ),
    );
    renderPage();

    expect(screen.getByTestId('proposals-partial')).toHaveTextContent('team-b');
    expect(rows()).toHaveLength(1);
  });

  it('says so when the feature is switched off, and reads nothing', () => {
    mockDraftPolicy = false;
    renderPage();

    expect(screen.getByTestId('proposals-disabled')).toBeInTheDocument();
    expect(screen.queryByTestId('proposals-table')).not.toBeInTheDocument();
    expect(mockUseAcrossWorkspaces).toHaveBeenCalledWith(false);
    expect(mockUsePerWorkspace).toHaveBeenCalledWith(
      ['team-a', 'team-b'],
      false,
    );
  });
});
