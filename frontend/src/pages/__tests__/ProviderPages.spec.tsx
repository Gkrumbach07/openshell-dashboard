import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import ProviderDetailPage from '../ProviderDetailPage';
import ProviderListPage from '../ProviderListPage';
import { serializeProfileFile } from '../../utils/profileFile';
import type { Provider, ProviderProfile } from '../../types';

let mockProviders: Provider[] = [];
let mockProfiles: ProviderProfile[] = [];
// How the profiles query stands when it has not answered with profiles.
// `stale` is a query that failed after it had answered once: it still holds
// the profiles it read then.
let mockProfilesState: {
  isLoading?: boolean;
  isError?: boolean;
  stale?: boolean;
} = {};

const idle = { mutate: jest.fn(), reset: jest.fn(), isPending: false };

jest.mock('../../api/providers', () => ({
  deleteProvider: jest.fn(),
  useProviders: () => ({ data: mockProviders, isLoading: false }),
  useProvider: (_workspace: string, name: string) => ({
    data: mockProviders.find((p) => p.metadata.name === name),
    isLoading: false,
  }),
  useProviderProfiles: () => ({
    data:
      mockProfilesState.isLoading ||
      (mockProfilesState.isError && !mockProfilesState.stale)
        ? undefined
        : mockProfiles,
    isLoading: !!mockProfilesState.isLoading,
    isError: !!mockProfilesState.isError,
    error: mockProfilesState.isError ? new Error('gateway away') : null,
    refetch: jest.fn(),
  }),
  useProviderRefreshStatus: () => ({ data: [], isError: false }),
  useConfigureProviderRefresh: () => idle,
  useRotateProviderCredential: () => idle,
  useDeleteProviderRefresh: () => idle,
}));
jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: () => ({ isWorkspaceAdmin: true }),
}));
jest.mock('../../app/AlertContext', () => ({
  useAlerts: () => ({ addSuccess: jest.fn(), addDanger: jest.fn() }),
}));
jest.mock('../../slots', () => ({ useSlots: () => ({}) }));
jest.mock('../../hooks/useBulkDelete', () => ({
  useBulkDelete: () => ({
    run: jest.fn(),
    isDeleting: false,
    error: undefined,
    clearError: jest.fn(),
  }),
}));

// The dialogs have their own specs. The refresh dialog says which keys it
// was given and whether it was given the profile.
jest.mock('../../components/provider/ProviderFormModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/provider/ConfigureRefreshModal', () => ({
  __esModule: true,
  default: ({
    credentialNames,
    profile,
  }: {
    credentialNames: string[];
    profile?: ProviderProfile;
  }) => (
    <div data-testid="refresh-keys">
      {credentialNames.join(',')}|{profile?.id ?? 'no profile'}
    </div>
  ),
}));

const provider = (
  name: string,
  overrides: Partial<Provider> = {},
): Provider => ({
  metadata: {
    id: `id-${name}`,
    name,
    workspace: 'team-a',
    createdAtMs: 0,
    resourceVersion: 7,
  },
  type: 'google-cloud',
  ...overrides,
});

// upstream's google-cloud profile, as far as these pages read it: a
// credential the gateway mints.
const google: ProviderProfile = {
  id: 'google-cloud',
  displayName: 'Google Cloud',
  category: 'OTHER',
  inferenceCapable: false,
  resourceVersion: 1,
  scope: 'platform',
  credentials: [
    {
      name: 'adc_token',
      envVars: ['GCP_ADC_ACCESS_TOKEN'],
      required: false,
      refresh: { strategy: 'OAUTH2_REFRESH_TOKEN' },
    },
  ],
};

// upstream's providers/github.yaml, with two credentials added to it: one
// that declares no environment variable and so is stored under its own name,
// and one the gateway refreshes. One endpoint names an access preset, one is
// limited to a path, one says what it allows with rules and one is plain TCP.
const github: ProviderProfile = {
  id: 'github',
  displayName: 'GitHub',
  description: 'GitHub API and Git operations',
  category: 'SOURCE_CONTROL',
  inferenceCapable: false,
  resourceVersion: 4,
  scope: 'workspace',
  source: 'user',
  credentials: [
    {
      name: 'api_token',
      description: 'GitHub token',
      envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
      required: true,
      authStyle: 'bearer',
      headerName: 'authorization',
    },
    { name: 'app_key', required: false },
    {
      name: 'oauth_token',
      envVars: ['GITHUB_OAUTH_TOKEN'],
      required: false,
      refresh: {
        strategy: 'OAUTH2_REFRESH_TOKEN',
        scopes: ['repo', 'read:org'],
        material: [
          { name: 'client_id', required: true, secret: false },
          { name: 'client_secret', required: true, secret: true },
          { name: 'refresh_token', required: true, secret: true },
        ],
      },
    },
  ],
  endpoints: [
    'api.github.com:443',
    'api.github.com:443',
    'github.com:443',
    'ssh.github.com:22',
  ],
  networkEndpoints: [
    {
      host: 'api.github.com',
      port: 443,
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
    },
    {
      host: 'api.github.com',
      port: 443,
      protocol: 'graphql',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
      path: '/graphql',
    },
    {
      host: 'github.com',
      port: 443,
      protocol: 'rest',
      rules: [{ allow: { method: 'GET', path: '**' } }],
    },
    { host: 'ssh.github.com', port: 22 },
  ],
  binaries: [{ path: '/usr/bin/gh' }, { path: '/usr/bin/git' }],
  discovery: { credentials: ['api_token'] },
};

// A value no page may ever show. Nothing below gives it to a page, because
// the BFF gives the browser none; the pages are checked for it all the same.
const SECRET = 'ghp_not-a-real-secret';

beforeEach(() => {
  mockProfiles = [google];
  mockProfilesState = {};
});

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

// `openshell provider list` prints, for each provider, its name, type, and
// how many credential keys and config keys it has.
describe('ProviderListPage', () => {
  it('shows the config keys of each provider beside its credentials', () => {
    mockProviders = [
      provider('with-config', {
        credentialNames: ['GCP_ADC_ACCESS_TOKEN'],
        config: { region: 'us-east1', project: 'demo' },
      }),
      provider('bare'),
    ];
    render(<ProviderListPage workspace="team-a" />);

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        'Name',
        'Profile',
        'Credentials',
        'Config',
        'Age',
      ]),
    );

    const [, withConfig, bare] = screen.getAllByRole('row');
    const config =
      within(withConfig).getAllByRole('cell')[headers.indexOf('Config')];
    // The keys, not the values: the list names what is set.
    expect(config).toHaveTextContent('projectregion');
    expect(config).not.toHaveTextContent('us-east1');
    expect(
      within(bare).getAllByRole('cell')[headers.indexOf('Config')],
    ).toHaveTextContent('-');
  });

  // The PROFILE, CATEGORY, CREDS and POLICY columns of the TUI's provider
  // list.
  it('shows what each provider gets from its profile', () => {
    mockProfiles = [google, github];
    mockProviders = [
      provider('gh', {
        type: 'github',
        profileWorkspace: 'team-a',
        credentialNames: ['GH_TOKEN', 'app_key'],
      }),
      provider('gcp'),
    ];
    render(<ProviderListPage workspace="team-a" />);

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      '',
      'Name',
      'Profile',
      'Category',
      'Credentials',
      'Policy',
      'Config',
      'Age',
      'Actions',
    ]);

    // The display name, with the type it is the profile of.
    expect(screen.getByTestId('provider-profile-gh')).toHaveTextContent(
      'GitHub github',
    );
    expect(screen.getByTestId('provider-category-gh')).toHaveTextContent(
      'source_control',
    );
    // The one required credential is held, under its second env var; the
    // other key held is an optional credential stored under its own name.
    const credentials = screen.getByTestId('provider-credentials-gh');
    expect(credentials).toHaveTextContent('1/1 req, 2 keys');
    expect(credentials).toHaveTextContent('GH_TOKEN');
    expect(credentials).toHaveTextContent('app_key');
    expect(screen.getByTestId('provider-policy-gh')).toHaveTextContent(
      '4 endpoints, 2 bins',
    );

    // Nothing required, nothing held, no endpoints.
    expect(screen.getByTestId('provider-profile-gcp')).toHaveTextContent(
      'Google Cloud google-cloud',
    );
    expect(screen.getByTestId('provider-category-gcp')).toHaveTextContent(
      'other',
    );
    expect(screen.getByTestId('provider-credentials-gcp')).toHaveTextContent(
      '0/0 req, 0 keys',
    );
    expect(screen.getByTestId('provider-policy-gcp')).toHaveTextContent(
      '0 endpoints, 0 bins',
    );
  });

  it('says a required credential is missing and that a profile does inference', () => {
    mockProfiles = [
      {
        ...github,
        inferenceCapable: true,
        networkEndpoints: [github.networkEndpoints![0]],
        endpoints: ['api.github.com:443'],
        binaries: [{ path: '/usr/bin/gh' }],
      },
    ];
    mockProviders = [
      provider('gh', {
        type: 'github',
        profileWorkspace: 'team-a',
        credentialNames: ['GITHUB_OAUTH_TOKEN'],
      }),
    ];
    render(<ProviderListPage workspace="team-a" />);
    expect(screen.getByTestId('provider-credentials-gh')).toHaveTextContent(
      '0/1 req, 1 key',
    );
    expect(screen.getByTestId('provider-policy-gh')).toHaveTextContent(
      '1 endpoint, 1 bin, inference',
    );
  });

  // A provider whose type matches no profile: the TUI shows the type with
  // "(unprofiled)" in its warning colour, "legacy", the keys, "no profile".
  it('marks a provider whose type matches no profile', () => {
    mockProviders = [
      provider('old', { type: 'gone', credentialNames: ['LEGACY_TOKEN'] }),
    ];
    render(<ProviderListPage workspace="team-a" />);

    const profile = screen.getByTestId('provider-profile-old');
    expect(profile).toHaveTextContent('gone (unprofiled)');
    expect(profile.querySelector('.pf-m-warning')).not.toBeNull();
    expect(screen.getByTestId('provider-category-old')).toHaveTextContent(
      'legacy',
    );
    const credentials = screen.getByTestId('provider-credentials-old');
    expect(credentials).toHaveTextContent('1 key');
    expect(credentials).not.toHaveTextContent('req');
    expect(screen.getByTestId('provider-policy-old')).toHaveTextContent(
      'no profile',
    );
  });

  // One id in two scopes: the profile a provider gets is the one the scope it
  // names resolves, which is the first wave's profileForProvider.
  it('resolves a profile by the scope the provider names', () => {
    mockProfiles = [
      { ...github, scope: 'platform', displayName: 'GitHub (platform)' },
      { ...github, displayName: 'GitHub (workspace)', binaries: [] },
    ];
    mockProviders = [
      provider('own', { type: 'github', profileWorkspace: 'team-a' }),
      provider('shared', { type: 'github' }),
    ];
    render(<ProviderListPage workspace="team-a" />);

    expect(screen.getByTestId('provider-profile-own')).toHaveTextContent(
      'GitHub (workspace)',
    );
    expect(screen.getByTestId('provider-policy-own')).toHaveTextContent(
      '4 endpoints, 0 bins',
    );
    expect(screen.getByTestId('provider-profile-shared')).toHaveTextContent(
      'GitHub (platform)',
    );
    expect(screen.getByTestId('provider-policy-shared')).toHaveTextContent(
      '4 endpoints, 2 bins',
    );
  });

  // "Unprofiled" is a finding, not the absence of an answer.
  it('does not call a provider unprofiled before the profiles are read', () => {
    mockProfilesState = { isLoading: true };
    mockProviders = [
      provider('gcp', { credentialNames: ['GCP_ADC_ACCESS_TOKEN'] }),
    ];
    render(<ProviderListPage workspace="team-a" />);

    const profile = screen.getByTestId('provider-profile-gcp');
    expect(profile).toHaveTextContent('google-cloud');
    expect(profile).not.toHaveTextContent('unprofiled');
    expect(screen.getByTestId('provider-category-gcp')).toHaveTextContent('-');
    expect(screen.getByTestId('provider-credentials-gcp')).toHaveTextContent(
      '1 key',
    );
    expect(screen.getByTestId('provider-policy-gcp')).toHaveTextContent('-');
  });

  it('says so when the profiles cannot be read', () => {
    mockProfilesState = { isError: true };
    mockProviders = [provider('gcp')];
    render(<ProviderListPage workspace="team-a" />);

    expect(
      screen.getByTestId('provider-profiles-unavailable'),
    ).toHaveTextContent('gateway away');
    expect(screen.getByTestId('provider-profile-gcp')).not.toHaveTextContent(
      'unprofiled',
    );
  });

  // The list is read again every 30 seconds. One failed read does not take
  // away what the last good one said.
  it('keeps the profiles it has when reading them again fails', () => {
    mockProfilesState = { isError: true, stale: true };
    mockProviders = [provider('gcp')];
    render(<ProviderListPage workspace="team-a" />);

    expect(
      screen.queryByTestId('provider-profiles-unavailable'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('provider-profile-gcp')).toHaveTextContent(
      'Google Cloud google-cloud',
    );
    expect(screen.getByTestId('provider-policy-gcp')).toHaveTextContent(
      '0 endpoints, 0 bins',
    );
  });
});

// `openshell provider get` prints the id, name, type, resource version, and
// the credential and config keys.
describe('ProviderDetailPage', () => {
  it('shows the resource version', () => {
    mockProviders = [
      provider('gcp', { credentialNames: ['GCP_ADC_ACCESS_TOKEN'] }),
    ];
    render(<ProviderDetailPage workspace="team-a" providerName="gcp" />);

    const details = screen.getByTestId('provider-details-card');
    expect(within(details).getByText('Resource version')).toBeVisible();
    expect(
      within(details).getByText('Resource version').parentElement
        ?.parentElement,
    ).toHaveTextContent('Resource version7');
  });

  // A provider created with runtime credentials holds none. Refresh is how
  // its credential comes to exist, so refresh can be configured for the key
  // its profile declares, with the profile to start the form from.
  it('offers refresh for the keys the profile declares when none is held', () => {
    mockProviders = [provider('gcp')];
    render(<ProviderDetailPage workspace="team-a" providerName="gcp" />);

    expect(screen.getByTestId('provider-credentials-card')).toHaveTextContent(
      'No credentials stored. This provider type resolves its credentials at runtime',
    );
    expect(screen.getByTestId('configure-refresh-button')).toBeEnabled();
    expect(screen.getByTestId('refresh-keys')).toHaveTextContent(
      'GCP_ADC_ACCESS_TOKEN|google-cloud',
    );
  });

  it('says a provider that needs credentials has none set', () => {
    mockProfiles = [
      {
        ...google,
        credentials: [
          { name: 'api_key', envVars: ['API_KEY'], required: true },
        ],
      },
    ];
    mockProviders = [provider('gcp')];
    render(<ProviderDetailPage workspace="team-a" providerName="gcp" />);
    expect(screen.getByTestId('provider-credentials-card')).toHaveTextContent(
      'No credentials set',
    );
  });

  it('offers no refresh when there is no key to configure it for', () => {
    mockProfiles = [];
    mockProviders = [provider('gcp')];
    render(<ProviderDetailPage workspace="team-a" providerName="gcp" />);
    expect(screen.getByTestId('configure-refresh-button')).toBeDisabled();
    expect(screen.getByTestId('refresh-keys')).toHaveTextContent('|no profile');
  });
});

// The TUI's provider detail: what the profile says about the provider, and
// the provider and the profile as YAML.
describe('ProviderDetailPage profile', () => {
  const gh = (overrides: Partial<Provider> = {}) =>
    provider('gh', {
      type: 'github',
      profileWorkspace: 'team-a',
      credentialNames: ['GH_TOKEN', 'app_key'],
      credentialExpiresAtMs: { GH_TOKEN: Date.UTC(2030, 0, 1) },
      config: { 'api.url': 'https://api.github.com', region: 'us "east"' },
      ...overrides,
    });
  const show = () =>
    render(<ProviderDetailPage workspace="team-a" providerName="gh" />);
  const openTab = (name: string) =>
    fireEvent.click(screen.getByRole('tab', { name }));

  beforeEach(() => {
    mockProfiles = [google, github];
    mockProviders = [gh()];
  });

  it('names the profile, its category and its description', () => {
    show();
    expect(screen.getByTestId('provider-profile-name')).toHaveTextContent(
      'GitHub',
    );
    expect(screen.getByTestId('provider-profile-category')).toHaveTextContent(
      'source_control',
    );
    expect(
      screen.getByTestId('provider-profile-description'),
    ).toHaveTextContent('GitHub API and Git operations');
    expect(
      screen.queryByTestId('provider-unprofiled-alert'),
    ).not.toBeInTheDocument();
  });

  // Each credential the profile declares, held or not, and not only the keys
  // the provider holds.
  it('lists the credentials the profile declares', () => {
    show();
    const card = screen.getByTestId('provider-credentials-card');
    expect(
      within(card)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Credential',
      'Requirement',
      'Env vars',
      'Status',
      'Value',
      'Expires',
    ]);

    const expires = new Date(Date.UTC(2030, 0, 1)).toLocaleString();
    expect(
      cellsOf(screen.getByTestId('provider-credential-api_token')),
    ).toEqual([
      'api_token',
      'required',
      'GITHUB_TOKENGH_TOKEN',
      // Several keys are accepted, so it says which one holds it.
      'Present as GH_TOKEN',
      'secret — write-only',
      expires,
    ]);
    // Declares no env var: it is stored under its own name, and held.
    expect(cellsOf(screen.getByTestId('provider-credential-app_key'))).toEqual([
      'app_key',
      'optional',
      '-',
      'Present',
      'secret — write-only',
      'Never',
    ]);
    // Not held, and the gateway mints it.
    expect(
      cellsOf(screen.getByTestId('provider-credential-oauth_token')),
    ).toEqual([
      'oauth_token',
      'optional',
      'GITHUB_OAUTH_TOKEN',
      'Missingresolved at runtime',
      '-',
      '-',
    ]);
  });

  it('warns when a credential the profile requires is missing', () => {
    mockProviders = [gh({ credentialNames: [], credentialExpiresAtMs: {} })];
    show();
    const status = within(
      screen.getByTestId('provider-credential-api_token'),
    ).getByText('Missing');
    expect(status.closest('.pf-m-warning')).not.toBeNull();
    // Still said in words, as before.
    expect(screen.getByTestId('provider-credentials-card')).toHaveTextContent(
      'No credentials set',
    );
  });

  it('shows a key the provider holds that the profile does not declare', () => {
    mockProviders = [gh({ credentialNames: ['GH_TOKEN', 'STRAY_KEY'] })];
    show();
    expect(
      cellsOf(screen.getByTestId('provider-credential-STRAY_KEY')),
    ).toEqual([
      'STRAY_KEY',
      'not declared by the profile',
      '-',
      'Present',
      'secret — write-only',
      'Never',
    ]);
  });

  // host:port, protocol, access and path of each endpoint, and the binaries.
  it('lists the endpoints and binaries of the profile as its policy', () => {
    show();
    const card = screen.getByTestId('provider-policy-card');
    const rows = within(card).getAllByRole('row').slice(1).map(cellsOf);
    expect(rows).toEqual([
      ['api.github.com:443', 'rest', 'read-only', '-'],
      ['api.github.com:443', 'graphql', 'read-only', '/graphql'],
      // No preset: what it allows is in its rules.
      ['github.com:443', 'rest', 'rules', '-'],
      // No protocol and no rules: plain TCP.
      ['ssh.github.com:22', 'l4', 'custom', '-'],
    ]);
    expect(card).toHaveTextContent('/usr/bin/gh');
    expect(card).toHaveTextContent('/usr/bin/git');
  });

  it('lists the credentials the profile marks for discovery', () => {
    show();
    expect(screen.getByTestId('provider-discovery-card')).toHaveTextContent(
      'api_token',
    );
  });

  // The strategy, the scopes and how many inputs the refresh takes, for each
  // credential that declares one. It is beside the refresh status, not in
  // place of it.
  it('shows the refresh the profile declares and keeps the refresh status', () => {
    show();
    const card = screen.getByTestId('provider-profile-refresh-card');
    expect(within(card).getAllByRole('row').slice(1).map(cellsOf)).toEqual([
      ['oauth_token', 'oauth2_refresh_token', 'repo, read:org', '3 keys'],
    ]);
    expect(screen.getByTestId('provider-refresh-card')).toBeInTheDocument();
  });

  it('says a profile declares no refresh, no endpoints and no discovery', () => {
    mockProfiles = [{ ...google, credentials: [] }];
    mockProviders = [provider('gh')];
    show();
    expect(
      screen.getByTestId('provider-profile-refresh-card'),
    ).toHaveTextContent('No refresh metadata in profile.');
    expect(screen.getByTestId('provider-policy-card')).toHaveTextContent(
      'No profile endpoints.',
    );
    expect(screen.getByTestId('provider-discovery-card')).toHaveTextContent(
      'None',
    );
  });

  // The TUI's "Profile: <none> (legacy/unprofiled provider)".
  it('says a provider is unprofiled and falls back to the keys it holds', () => {
    mockProviders = [gh({ type: 'gone' })];
    show();

    expect(screen.getByTestId('provider-unprofiled-alert')).toHaveTextContent(
      'Legacy/unprofiled provider',
    );
    expect(screen.getByTestId('provider-profile-name')).toHaveTextContent(
      'none (legacy/unprofiled provider)',
    );
    expect(screen.getByTestId('provider-profile-category')).toHaveTextContent(
      'legacy',
    );

    const card = screen.getByTestId('provider-credentials-card');
    expect(
      within(card)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Key', 'Value', 'Expires']);
    expect(within(card).getAllByRole('row').slice(1).map(cellsOf)).toEqual([
      [
        'GH_TOKEN',
        'secret — write-only',
        new Date(Date.UTC(2030, 0, 1)).toLocaleString(),
      ],
      ['app_key', 'secret — write-only', 'Never'],
    ]);
    expect(screen.getByTestId('provider-policy-card')).toHaveTextContent(
      'No provider profile found',
    );
    expect(screen.getByTestId('provider-discovery-card')).toHaveTextContent(
      'None',
    );
    expect(
      screen.getByTestId('provider-profile-refresh-card'),
    ).toHaveTextContent('No profile refresh metadata.');
  });

  it('does not call a provider unprofiled when the profiles cannot be read', () => {
    mockProfilesState = { isError: true };
    show();
    expect(
      screen.getByTestId('provider-profiles-unavailable'),
    ).toHaveTextContent('gateway away');
    expect(
      screen.queryByTestId('provider-unprofiled-alert'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('provider-policy-card'),
    ).not.toBeInTheDocument();
    // What the provider itself holds is still shown.
    expect(screen.getByTestId('provider-credentials-card')).toHaveTextContent(
      'GH_TOKEN',
    );
  });

  it('keeps the profile it has when reading the profiles again fails', () => {
    mockProfilesState = { isError: true, stale: true };
    show();
    expect(
      screen.queryByTestId('provider-profiles-unavailable'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('provider-profile-name')).toHaveTextContent(
      'GitHub',
    );
    expect(screen.getByTestId('provider-policy-card')).toHaveTextContent(
      'api.github.com:443',
    );
  });

  // The TUI's Object YAML: the same fields in the same order, every key the
  // provider holds masked the same way, and nothing else.
  it('shows the provider as YAML with every credential redacted', () => {
    mockProviders = [
      gh({
        metadata: {
          id: 'id-gh',
          name: 'gh',
          workspace: 'team-a',
          createdAtMs: 0,
          resourceVersion: 7,
          labels: { team: 'ml', env: 'prod' },
        },
      }),
    ];
    show();
    openTab('Object YAML');

    expect(screen.getByTestId('provider-object-yaml').textContent).toBe(
      [
        'name: "gh"',
        'type: "github"',
        'credentials:',
        '  GH_TOKEN: "<redacted>"',
        '  app_key: "<redacted>"',
        'config:',
        '  api.url: "https://api.github.com"',
        '  region: "us \\"east\\""',
        'credential_expiration_times:',
        '  GH_TOKEN: 2030-01-01T00:00:00Z',
        'metadata:',
        '  id: "id-gh"',
        '  resource_version: 7',
        '  labels:',
        '    env: "prod"',
        '    team: "ml"',
        '',
      ].join('\n'),
    );
    // The summary is the other view, not shown at the same time.
    expect(
      screen.queryByTestId('provider-details-card'),
    ).not.toBeInTheDocument();
  });

  // The same YAML `provider profile export` gives, by the same code.
  it('shows the profile as the YAML a profile export gives', () => {
    show();
    openTab('Profile YAML');
    const yaml = screen.getByTestId('provider-profile-yaml').textContent ?? '';
    expect(yaml).toBe(serializeProfileFile(github, 'yaml'));
    expect(yaml).toContain('id: github');
    expect(yaml).toContain('env_vars:');
  });

  it('has no profile YAML for a provider without a profile', () => {
    mockProviders = [gh({ type: 'gone' })];
    show();
    openTab('Profile YAML');
    expect(
      screen.getByTestId('provider-profile-yaml-unavailable'),
    ).toHaveTextContent('No provider profile is available for this provider.');
    expect(screen.queryByTestId('provider-profile-yaml')).toBeNull();
  });

  it('has no profile YAML when the endpoints are not whole', () => {
    mockProfiles = [{ ...github, networkEndpoints: undefined }];
    show();
    openTab('Profile YAML');
    expect(
      screen.getByTestId('provider-profile-yaml-unavailable'),
    ).toHaveTextContent('cannot be shown whole');
    // The policy card still says where the endpoints point.
    openTab('Details');
    expect(screen.getByTestId('provider-policy-card')).toHaveTextContent(
      'ssh.github.com:22',
    );
  });

  // The BFF gives the browser no credential value, and the Provider type has
  // nowhere to put one. Should one ever arrive, as the gateway's own answer
  // carries them, no view prints it: each is built from the key names.
  it('never shows a credential value in any view', () => {
    mockProviders = [
      {
        ...gh(),
        credentials: { GH_TOKEN: SECRET, app_key: 'REDACTED' },
      } as Provider,
    ];
    const { container } = show();
    for (const tab of ['Details', 'Object YAML', 'Profile YAML']) {
      openTab(tab);
      expect(container).toHaveTextContent('GH_TOKEN');
      expect(container).not.toHaveTextContent(SECRET);
      expect(container).not.toHaveTextContent('REDACTED');
    }
  });
});
