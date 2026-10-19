import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { CurrentUser } from '../../types';

let mockIsPlatformAdmin = false;
let mockIsUser = true;
let mockIsUnentitled = false;
let mockUser: CurrentUser | undefined;
let mockPendingProposals = 0;

jest.mock('../../api/gateway', () => ({
  useGatewayInfo: () => ({ isLoading: false, isError: false, data: undefined }),
  useGatewayCompatibility: () => ({
    isLoading: false,
    isError: false,
    data: undefined,
  }),
}));
jest.mock('../../api/auth', () => ({
  useCurrentUser: () => ({ data: mockUser }),
  useFeatureFlags: () => ({
    globalPolicy: true,
    settings: true,
    draftPolicy: true,
  }),
}));
jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isUser: mockIsUser,
    isUnentitled: mockIsUnentitled,
  }),
}));
jest.mock('../../api/draftSummary', () => ({
  useAllWorkspacesDraftSummary: jest.fn(() => ({
    totalPending: mockPendingProposals,
  })),
}));
jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(() => ({ data: [] })),
}));
jest.mock('../../api/workspaces', () => ({
  useWorkspaces: jest.fn(() => ({ data: [] })),
}));
jest.mock('../theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }),
}));
// Jest resolves the "~/" alias before it reaches the "*.svg" stub, so the two
// logos would otherwise be parsed as JavaScript.
jest.mock('~/assets/openshell-logo.svg', () => ({
  __esModule: true,
  default: 'openshell-logo.svg',
}));
jest.mock('~/assets/openshell-logo-dark.svg', () => ({
  __esModule: true,
  default: 'openshell-logo-dark.svg',
}));

import { useAllSandboxes } from '../../api/allWorkspaces';
import { useAllWorkspacesDraftSummary } from '../../api/draftSummary';
import { NAV_COUNT_POLL_MS } from '../../constants';
import { useWorkspaces } from '../../api/workspaces';
import AppLayout from '../AppLayout';

const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseWorkspaces = useWorkspaces as jest.Mock;

const renderShell = (route: string) =>
  render(
    <MemoryRouter
      initialEntries={[route]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppLayout>
        <h1>Page</h1>
      </AppLayout>
    </MemoryRouter>,
  );

// jsdom has no width, so the page keeps its sidebar collapsed and out of the
// accessibility tree. The entries are in the document all the same.
const primaryNav = () =>
  within(
    screen.getByRole('navigation', {
      name: 'Primary navigation',
      hidden: true,
    }),
  );

const navLinks = () =>
  primaryNav()
    .getAllByRole('link', { hidden: true })
    .map((link) => [link.textContent, link.getAttribute('href')]);

const currentNavItem = () =>
  primaryNav().getByRole('link', { current: 'page', hidden: true });

// Opens the user menu and picks an entry. The test id is on the list item and
// the click handler on the button inside it. The menu positions itself after
// it opens, so the test waits for it to settle.
const pickFromUserMenu = async (testId: string) => {
  fireEvent.click(screen.getByTestId('current-user'));
  const item = await screen.findByTestId(testId);
  fireEvent.click(within(item).getByRole('menuitem'));
  await act(async () => {});
};

describe('AppLayout navigation', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = true;
    mockIsUnentitled = false;
    mockUser = { subject: 'user-1', roles: [] };
    mockPendingProposals = 0;
    mockUseAllSandboxes.mockReset();
    mockUseAllSandboxes.mockReturnValue({ data: [] });
    mockUseWorkspaces.mockReset();
    mockUseWorkspaces.mockReturnValue({ data: [] });
  });

  // The lists across workspaces are answered for platform admins only, so
  // nobody else is shown the way to them. Sandboxes sits with All resources:
  // it is the list that used to be that page's first tab.
  it('offers Sandboxes and All resources to a platform admin', () => {
    mockIsPlatformAdmin = true;
    renderShell('/workspaces');

    expect(navLinks()).toEqual([
      ['Gateway', '/gateway'],
      ['Workspaces', '/workspaces'],
      ['Sandboxes', '/sandboxes'],
      ['Proposals', '/proposals'],
      ['Resources', '/all-workspaces'],
      ['Provider profiles', '/provider-profiles'],
      ['Global policy', '/global-policy'],
      ['Settings', '/settings'],
    ]);
    expect(mockUseAllSandboxes).toHaveBeenCalledWith(undefined, {
      enabled: true,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  // Proposals are a sandbox's, not the platform's: a standard user reviews
  // the ones in the workspaces they are a member of, so the entry is theirs
  // too. Sandboxes and All resources are the cross-workspace lists, which
  // the gateway answers for a platform admin only.
  it('does not offer them to anyone else', () => {
    renderShell('/workspaces');

    expect(navLinks()).toEqual([
      ['Workspaces', '/workspaces'],
      ['Proposals', '/proposals'],
    ]);
    expect(mockUseAllSandboxes).toHaveBeenCalledWith(undefined, {
      enabled: false,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  // The badge is the whole point of the entry: how many rules are waiting for
  // a decision, without opening the page.
  it('counts the pending proposals on the entry', () => {
    mockPendingProposals = 3;
    renderShell('/workspaces');

    expect(screen.getByTestId('proposals-badge')).toHaveTextContent('3');
  });

  // The count costs the gateway one draft read per sandbox, so the shell
  // reads it at the navigation's pace, not the Proposals page's.
  it('reads the proposal count at the navigation pace', () => {
    mockIsPlatformAdmin = true;
    renderShell('/workspaces');

    expect(useAllWorkspacesDraftSummary).toHaveBeenCalledWith(true, {
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('badges nothing when nothing is waiting', () => {
    renderShell('/workspaces');

    expect(screen.queryByTestId('proposals-badge')).not.toBeInTheDocument();
  });

  // The same badge the Proposals entry carries: how many there are, without
  // opening the page. Zero is not badged.
  it('counts the sandboxes on the entry', () => {
    mockIsPlatformAdmin = true;
    mockUseAllSandboxes.mockReturnValue({ data: [{}, {}, {}] });
    renderShell('/workspaces');

    expect(screen.getByTestId('sandboxes-badge')).toHaveTextContent('3');
  });

  it('badges nothing when the gateway has no sandboxes', () => {
    mockIsPlatformAdmin = true;
    renderShell('/workspaces');

    expect(screen.queryByTestId('sandboxes-badge')).not.toBeInTheDocument();
  });

  // Same badge again: how many workspaces the signed-in user can see.
  it('counts the workspaces on the entry', () => {
    mockUseWorkspaces.mockReturnValue({ data: [{}, {}] });
    renderShell('/workspaces');

    expect(screen.getByTestId('workspaces-badge')).toHaveTextContent('2');
  });

  // The shell reads it on every page, so at the navigation's pace, and not
  // at all for a user the gateway gives no role.
  it('reads the workspace count at the navigation pace', () => {
    renderShell('/workspaces');

    expect(mockUseWorkspaces).toHaveBeenCalledWith(undefined, {
      enabled: true,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('does not ask for the workspaces of a user with no role', () => {
    mockIsUser = false;
    mockIsUnentitled = true;
    renderShell('/workspaces');

    expect(mockUseWorkspaces).toHaveBeenCalledWith(undefined, {
      enabled: false,
      refetchInterval: NAV_COUNT_POLL_MS,
    });
  });

  it('badges nothing when the user has no workspaces', () => {
    renderShell('/workspaces');

    expect(screen.queryByTestId('workspaces-badge')).not.toBeInTheDocument();
  });

  // Gateway leads, ungrouped: the landing page is not one of a set. A rule
  // starts each of the two sections below it, and nothing names them.
  it('rules off the sections a platform admin sees', () => {
    mockIsPlatformAdmin = true;
    renderShell('/gateway');

    expect(primaryNav().getAllByTestId('nav-section-rule')).toHaveLength(2);
    expect(
      primaryNav().queryByText('Workspaces', { selector: 'h2' }),
    ).not.toBeInTheDocument();
    expect(
      primaryNav().queryByText('Platform', { selector: 'h2' }),
    ).not.toBeInTheDocument();
  });

  // A rule above the only section there is would divide the sidebar from
  // nothing. A standard user keeps the flat list they had.
  it('leaves the nav flat and unruled for a standard user', () => {
    renderShell('/workspaces');

    expect(primaryNav().queryAllByTestId('nav-section-rule')).toHaveLength(0);
  });

  // Workspaces and All resources share a word, not a path prefix. A workspace
  // sandbox path shares a segment with Sandboxes the same way. Each entry is
  // current only on its own pages.
  it.each([
    ['/sandboxes', 'Sandboxes'],
    ['/all-workspaces', 'Resources'],
    ['/workspaces', 'Workspaces'],
    ['/workspaces/team-a/sandboxes/agent', 'Workspaces'],
  ])('marks the right entry as current on %s', (route, entry) => {
    mockIsPlatformAdmin = true;
    renderShell(route);

    expect(currentNavItem()).toHaveTextContent(new RegExp(`^${entry}$`));
  });
});

// Unentitled users keep the masthead (theme, identity, sign-out) but must not
// see side nav, the nav toggle, or the gateway health chip.
describe('AppLayout entitlement chrome', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = false;
    mockIsUnentitled = true;
    mockUser = { subject: 'user-1', roles: [] };
  });

  it('hides side nav, nav toggle, and gateway health when unentitled', () => {
    renderShell('/workspaces');

    expect(
      screen.queryByRole('navigation', {
        name: 'Primary navigation',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Global navigation' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('gateway-status-region'),
    ).not.toBeInTheDocument();

    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('current-user')).toBeInTheDocument();
  });
});

// What `openshell whoami` prints, for the session the dashboard is using.
describe('AppLayout identity', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
    mockIsUser = true;
    mockIsUnentitled = false;
    mockUseAllSandboxes.mockReturnValue({ data: [] });
    mockUser = {
      subject: 'f3b1c2d4',
      displayName: 'Ada Lovelace',
      identityProvider: 'oidc',
      roles: ['openshell-user'],
      scopes: ['openid', 'sandbox:read'],
    };
  });

  it('shows the signed-in identity from the user menu', async () => {
    renderShell('/workspaces');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await pickFromUserMenu('view-identity');

    const dialog = within(
      screen.getByRole('dialog', { name: 'Signed-in identity' }),
    );
    expect(dialog.getByTestId('identity-subject')).toHaveTextContent(
      'f3b1c2d4',
    );
    expect(dialog.getByTestId('identity-name')).toHaveTextContent(
      'Ada Lovelace',
    );
    expect(dialog.getByTestId('identity-provider')).toHaveTextContent('oidc');
    expect(dialog.getByTestId('identity-roles')).toHaveTextContent(
      'openshell-user',
    );
    expect(dialog.getByTestId('identity-scopes')).toHaveTextContent('openid');
    expect(dialog.getByTestId('identity-scopes')).toHaveTextContent(
      'sandbox:read',
    );
  });

  it('closes the identity again', async () => {
    renderShell('/workspaces');
    await pickFromUserMenu('view-identity');

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the identity even before the gateway has answered', async () => {
    mockUser = undefined;
    renderShell('/workspaces');

    await pickFromUserMenu('view-identity');

    expect(screen.getByTestId('identity-subject')).toHaveTextContent('None');
  });
});
