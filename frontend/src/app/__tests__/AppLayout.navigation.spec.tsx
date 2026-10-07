import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { CurrentUser } from '../../types';

let mockIsPlatformAdmin = false;
let mockUser: CurrentUser | undefined;

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
  useFeatureFlags: () => ({ globalPolicy: true, settings: true }),
}));
jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({ isPlatformAdmin: mockIsPlatformAdmin }),
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

import AppLayout from '../AppLayout';

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
    mockUser = { subject: 'user-1', roles: [] };
  });

  // The lists across workspaces are answered for platform admins only, so
  // nobody else is shown the way to them.
  it('offers All workspaces to a platform admin, after Workspaces', () => {
    mockIsPlatformAdmin = true;
    renderShell('/workspaces');

    expect(navLinks()).toEqual([
      ['Gateway', '/gateway'],
      ['Workspaces', '/workspaces'],
      ['All workspaces', '/all-workspaces'],
      ['Provider profiles', '/provider-profiles'],
      ['Global policy', '/global-policy'],
      ['Settings', '/settings'],
    ]);
  });

  it('does not offer it to anyone else', () => {
    renderShell('/workspaces');

    expect(navLinks()).toEqual([['Workspaces', '/workspaces']]);
  });

  // The two entries share a word, not a path prefix: each is current only on
  // its own pages.
  it.each([
    ['/all-workspaces', 'All workspaces'],
    ['/workspaces', 'Workspaces'],
    ['/workspaces/team-a/sandboxes/agent', 'Workspaces'],
  ])('marks the right entry as current on %s', (route, entry) => {
    mockIsPlatformAdmin = true;
    renderShell(route);

    expect(currentNavItem()).toHaveTextContent(new RegExp(`^${entry}$`));
  });
});

// What `openshell whoami` prints, for the session the dashboard is using.
describe('AppLayout identity', () => {
  beforeEach(() => {
    mockIsPlatformAdmin = false;
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
