import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { parse as parseYaml } from 'yaml';

import ProfilesPanel from '../provider/ProfilesPanel';
import type { ProviderProfile } from '../../types';

const mockDelete = jest.fn();
const mockDownload = jest.fn();
let mockProfiles: ProviderProfile[] = [];
const mockUseProviderProfiles = jest.fn();

jest.mock('../../api/providers', () => ({
  PLATFORM_PROFILE_SCOPE: '@platform',
  useProviderProfiles: (scope: string) => mockUseProviderProfiles(scope),
  useDeleteProviderProfile: jest.fn(() => ({
    mutate: mockDelete,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

jest.mock('../../utils/download', () => ({
  downloadText: (...args: unknown[]) => mockDownload(...args),
}));

// The modals have their own specs. Here they say whether they are open, in
// which scope, and for which profile.
jest.mock('../CreateProfileModal', () => ({
  __esModule: true,
  default: ({ workspace, isOpen }: { workspace: string; isOpen: boolean }) =>
    isOpen ? <div data-testid="create-modal">{workspace}</div> : null,
}));
jest.mock('../provider/ProfileFileModal', () => ({
  __esModule: true,
  default: ({
    scope,
    isOpen,
    target,
  }: {
    scope: string;
    isOpen: boolean;
    target?: ProviderProfile;
  }) =>
    isOpen ? (
      <div data-testid={target ? 'update-modal' : 'import-modal'}>
        {scope}
        {target ? `:${target.scope}/${target.id}` : ''}
      </div>
    ) : null,
}));

const profile = (
  overrides: Partial<ProviderProfile> & Pick<ProviderProfile, 'id'>,
): ProviderProfile => ({
  displayName: overrides.id,
  category: 'SOURCE_CONTROL',
  credentials: [],
  inferenceCapable: false,
  resourceVersion: 1,
  source: 'user',
  ...overrides,
});

// What a workspace lists on a 0.1.x gateway: its own profile, a platform
// profile, the platform profile its own profile shadows, and one an
// interceptor vends, which no scope owns.
const own = profile({
  id: 'github',
  displayName: 'GitHub',
  scope: 'workspace',
  resourceVersion: 4,
  description: 'GitHub API and Git operations',
  annotations: { 'example.com/owner': 'platform-team' },
  credentials: [
    {
      name: 'api_token',
      envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
      required: true,
      authStyle: 'bearer',
      headerName: 'authorization',
    },
    {
      name: 'session',
      required: false,
      refresh: { strategy: 'OAUTH2_REFRESH_TOKEN' },
    },
  ],
  endpoints: ['api.github.com:443', 'github.com:443'],
  networkEndpoints: [
    {
      host: 'api.github.com',
      port: 443,
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
    },
    {
      host: 'github.com',
      port: 443,
      protocol: 'rest',
      rules: [{ allow: { method: 'GET', path: '**' } }],
    },
  ],
  binaries: [{ path: '/usr/bin/gh' }],
});
const shadowed = profile({ id: 'github', scope: 'platform' });
const shared = profile({ id: 'openai', scope: 'platform' });
const vended = profile({ id: 'slack', source: 'interceptor/governance' });

const row = (scope: string, id: string) =>
  screen.getByTestId(`profile-row-${scope}/${id}`);

// Opens or closes a row's menu. The menu positions itself after the click, so
// the click is given the time to settle.
const toggleMenu = async (scope: string, id: string) => {
  await act(async () => {
    fireEvent.click(
      within(row(scope, id)).getByRole('button', { name: 'Kebab toggle' }),
    );
  });
};

// The actions the row's menu offers, by title.
const actions = async (scope: string, id: string): Promise<string[]> => {
  await toggleMenu(scope, id);
  const titles = screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
  await toggleMenu(scope, id);
  return titles;
};

const choose = async (scope: string, id: string, title: string) => {
  await toggleMenu(scope, id);
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: title }));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfiles = [own, shadowed, shared, vended];
  mockUseProviderProfiles.mockImplementation(() => ({
    data: mockProfiles,
    isLoading: false,
    isError: false,
  }));
});

describe('ProfilesPanel in a workspace', () => {
  const renderPanel = (canManage = true) =>
    render(<ProfilesPanel scope="team-a" canManage={canManage} />);

  it('lists the profiles of the workspace it is given', () => {
    renderPanel();
    expect(mockUseProviderProfiles).toHaveBeenCalledWith('team-a');
  });

  // The same id can be listed twice, once per scope; the scope column is what
  // tells the two apart.
  it('shows which scope owns each profile', () => {
    renderPanel();
    expect(
      within(row('workspace', 'github')).getByText('Workspace'),
    ).toBeVisible();
    expect(
      within(row('platform', 'github')).getByText('Platform'),
    ).toBeVisible();
    expect(
      within(row('platform', 'openai')).getByText('Platform'),
    ).toBeVisible();
    expect(
      within(row('', 'slack')).getByText('interceptor/governance'),
    ).toBeVisible();
  });

  // The gateway refuses to update or delete, through a workspace, a profile
  // the workspace does not own: a platform profile is not found there, and an
  // interceptor's is read-only.
  it('offers update and delete only for the profiles the workspace owns', async () => {
    renderPanel();
    const exports = ['Export as YAML', 'Export as JSON'];
    expect(await actions('workspace', 'github')).toEqual([
      ...exports,
      'Update from file',
      'Delete',
    ]);
    expect(await actions('platform', 'github')).toEqual(exports);
    expect(await actions('platform', 'openai')).toEqual(exports);
    expect(await actions('', 'slack')).toEqual(exports);
  });

  it('offers a viewer who cannot manage the workspace the exports alone', async () => {
    renderPanel(false);
    expect(await actions('workspace', 'github')).toEqual([
      'Export as YAML',
      'Export as JSON',
    ]);
    expect(screen.queryByTestId('create-profile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-profiles')).not.toBeInTheDocument();
  });

  it('exports a profile as the file the CLI would write for it', async () => {
    renderPanel();
    await choose('workspace', 'github', 'Export as YAML');

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [name, text, type] = mockDownload.mock.calls[0];
    // "github" is listed twice, as the workspace's own profile and as the
    // platform profile it shadows, so the name says which one this is.
    expect(name).toBe('github.workspace.yaml');
    expect(type).toBe('application/yaml');
    // Whole: the resource version an update needs, and what the endpoints
    // allow.
    expect(parseYaml(text)).toMatchObject({
      id: 'github',
      resource_version: 4,
      annotations: { 'example.com/owner': 'platform-team' },
      credentials: [
        { name: 'api_token', header_name: 'authorization' },
        { name: 'session', refresh: { strategy: 'oauth2_refresh_token' } },
      ],
      endpoints: [
        { host: 'api.github.com', access: 'read-only', enforcement: 'enforce' },
        {
          host: 'github.com',
          rules: [{ allow: { method: 'GET', path: '**' } }],
        },
      ],
      binaries: ['/usr/bin/gh'],
      scope: 'workspace',
    });

    await choose('workspace', 'github', 'Export as JSON');
    const [jsonName, jsonText, jsonType] = mockDownload.mock.calls[1];
    expect(jsonName).toBe('github.workspace.json');
    expect(jsonType).toBe('application/json');
    expect(JSON.parse(jsonText)).toMatchObject({
      id: 'github',
      resource_version: 4,
    });
  });

  // An id only one scope lists needs no telling apart: the file is named
  // for the profile, as `openshell provider profile export` users name it.
  it('names the file by the id alone when the id is listed once', async () => {
    renderPanel();
    await choose('platform', 'openai', 'Export as YAML');
    await choose('platform', 'openai', 'Export as JSON');

    expect(mockDownload.mock.calls.map(([name]) => name)).toEqual([
      'openai.yaml',
      'openai.json',
    ]);
  });

  // The row that was clicked is the one exported, not whatever the scope
  // resolves the id to: the platform profile a workspace profile shadows is
  // listed, and is a different profile.
  it('exports the shadowed platform profile as itself', async () => {
    renderPanel();
    await choose('platform', 'github', 'Export as YAML');
    expect(mockDownload.mock.calls[0][0]).toBe('github.platform.yaml');
    expect(parseYaml(mockDownload.mock.calls[0][1])).toMatchObject({
      id: 'github',
      scope: 'platform',
      endpoints: [],
    });
  });

  // A backend that reads profiles through the SDK has the endpoint summaries
  // and not the endpoints. A file written from that would say the endpoints
  // allow nothing in particular.
  it('does not export a profile whose endpoints it does not have whole', async () => {
    mockProfiles = [{ ...own, networkEndpoints: undefined }];
    renderPanel();
    await toggleMenu('workspace', 'github');
    const item = screen.getByRole('menuitem', { name: /Export as YAML/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('opens the import, create and update dialogs for the workspace', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('import-profiles'));
    expect(screen.getByTestId('import-modal')).toHaveTextContent('team-a');

    fireEvent.click(screen.getByTestId('create-profile'));
    expect(screen.getByTestId('create-modal')).toHaveTextContent('team-a');

    await choose('workspace', 'github', 'Update from file');
    expect(screen.getByTestId('update-modal')).toHaveTextContent(
      'team-a:workspace/github',
    );
  });

  it('deletes a profile the workspace owns after confirmation', async () => {
    renderPanel();
    await choose('workspace', 'github', 'Delete');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'The gateway refuses while a provider still uses it.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][0]).toBe('github');
  });

  it('shows what a profile declares when its row is expanded', () => {
    renderPanel();
    fireEvent.click(
      within(row('workspace', 'github')).getByRole('button', {
        name: 'Details',
      }),
    );
    const details = screen.getByText('GitHub API and Git operations')
      .parentElement as HTMLElement;
    expect(details).toHaveTextContent(
      'api_token (required), as GITHUB_TOKEN, GH_TOKEN',
    );
    expect(details).toHaveTextContent('refresh: oauth2_refresh_token');
    expect(details).toHaveTextContent(
      'api.github.com:443 rest, read only, enforce',
    );
    expect(details).toHaveTextContent('github.com:443 rest, 1 allow rules');
    expect(details).toHaveTextContent('/usr/bin/gh');
    expect(details).toHaveTextContent('example.com/owner=platform-team');
  });

  // A gateway serves the profiles that were imported into it and nothing
  // else, so an empty list is where importing starts.
  it('offers the import first when there are no profiles', () => {
    mockProfiles = [];
    renderPanel();
    expect(screen.getByText('No provider profiles')).toBeVisible();
    fireEvent.click(screen.getByTestId('import-profiles-empty'));
    expect(screen.getByTestId('import-modal')).toHaveTextContent('team-a');
  });
});

describe('ProfilesPanel in the platform scope', () => {
  beforeEach(() => {
    mockProfiles = [shared, vended];
  });
  const renderPanel = (canManage = true) =>
    render(<ProfilesPanel scope="@platform" canManage={canManage} />);

  it('lists the platform scope and manages the profiles it owns', async () => {
    renderPanel();
    expect(mockUseProviderProfiles).toHaveBeenCalledWith('@platform');
    expect(await actions('platform', 'openai')).toEqual([
      'Export as YAML',
      'Export as JSON',
      'Update from file',
      'Delete',
    ]);
    expect(await actions('', 'slack')).toEqual([
      'Export as YAML',
      'Export as JSON',
    ]);
  });

  it('imports into the platform scope', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('import-profiles'));
    expect(screen.getByTestId('import-modal')).toHaveTextContent('@platform');
  });

  it('says what deleting a platform profile does to every workspace', async () => {
    renderPanel();
    await choose('platform', 'openai', 'Delete');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'will be deleted from the platform scope, and no workspace will see it any more',
    );
  });
});
