import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import ProfileFileModal from '../provider/ProfileFileModal';
import { PLATFORM_PROFILE_SCOPE } from '../../api/providers';
import { post, put } from '../../api/client';
import { serializeProfileFile } from '../../utils/profileFile';
import type {
  ImportProfileRequest,
  ProfileDiagnostic,
  ProviderProfile,
} from '../../types';

// The hooks are the real ones; only the HTTP calls under them are stubbed, so
// what is asserted is what would be sent.
jest.mock('../../api/client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

const mockPost = post as jest.Mock;
const mockPut = put as jest.Mock;

const fixture = (path: string): string =>
  readFileSync(
    join(__dirname, '../../utils/__tests__/fixtures/provider-profiles', path),
    'utf8',
  );

const file = (name: string, text: string) => new File([text], name);

// What the gateway answers a lint and an import with, by default: every
// profile is fine.
let lintDiagnostics: ProfileDiagnostic[] = [];
let importDiagnostics: ProfileDiagnostic[] | undefined;

const profilesOf = (call: unknown[]): ImportProfileRequest[] =>
  (call[1] as { profiles: ImportProfileRequest[] }).profiles;

const calls = (suffix: string) =>
  mockPost.mock.calls.filter(([path]) => (path as string).endsWith(suffix));

beforeEach(() => {
  jest.clearAllMocks();
  lintDiagnostics = [];
  importDiagnostics = undefined;
  mockPost.mockImplementation(
    async (path: string, body: { profiles: ImportProfileRequest[] }) => {
      if (path.endsWith('/lint')) {
        return {
          diagnostics: lintDiagnostics,
          valid: !lintDiagnostics.some((d) => d.severity === 'error'),
        };
      }
      return importDiagnostics
        ? { diagnostics: importDiagnostics, profiles: [], imported: false }
        : { profiles: body.profiles, imported: true };
    },
  );
  mockPut.mockImplementation(
    async (_path: string, body: { profile: ImportProfileRequest }) => ({
      profile: body.profile,
      updated: true,
    }),
  );
});

const onClose = jest.fn();
const onSuccess = jest.fn();

const renderModal = (scope = 'team-a', target?: ProviderProfile) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfileFileModal
        scope={scope}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
        target={target}
      />
    </QueryClientProvider>,
  );

const choose = (...files: File[]) => {
  const input = screen
    .getByTestId('profile-file-upload')
    .querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
};

const submit = () => screen.getByTestId('profile-file-submit');
const diagnostics = () => screen.getByTestId('profile-diagnostics');

describe('ProfileFileModal importing', () => {
  it('has the gateway check the profiles, then imports them whole', async () => {
    renderModal();
    expect(submit()).toBeDisabled();

    choose(
      file('github.yaml', fixture('providers/github.yaml')),
      file('aws.yml', fixture('providers/aws.yaml')),
    );

    // Checked before anything is written.
    expect(
      await screen.findByText('The gateway accepts 2 profiles'),
    ).toBeVisible();
    expect(calls('/provider-profiles')).toHaveLength(0);
    const [lint] = calls('/lint');
    expect(lint[0]).toBe('/api/v1/workspaces/team-a/provider-profiles/lint');
    expect(profilesOf(lint).map((p) => [p.id, p.importSource])).toEqual([
      ['github', 'github.yaml'],
      ['aws', 'aws.yml'],
    ]);

    expect(submit()).toHaveTextContent('Import 2 profiles');
    fireEvent.click(submit());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const [imported] = calls('/provider-profiles');
    expect(imported[0]).toBe('/api/v1/workspaces/team-a/provider-profiles');
    const [github, aws] = profilesOf(imported);
    // What the form could not say and a file can: what the endpoints allow,
    // which binaries may reach them, and how a credential is refreshed.
    expect(github.networkEndpoints?.[0]).toEqual({
      host: 'api.github.com',
      port: 443,
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
    });
    expect(github.networkEndpoints?.[2].rules).toHaveLength(4);
    expect(github.binaries).toHaveLength(4);
    expect(github.credentials?.[0].headerName).toBe('authorization');
    expect(aws.credentials?.[0].refresh).toMatchObject({
      strategy: 'AWS_STS_ASSUME_ROLE',
      refreshBefore: '300s',
    });

    expect(onSuccess).toHaveBeenCalledWith('Imported 2 profiles');
    expect(onClose).toHaveBeenCalled();
  });

  it('imports into the platform scope', async () => {
    renderModal(PLATFORM_PROFILE_SCOPE);
    choose(file('github.json', JSON.stringify({ id: 'p', display_name: 'P' })));
    expect(
      await screen.findByText('The gateway accepts 1 profile'),
    ).toBeVisible();
    fireEvent.click(submit());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    expect(calls('/lint')[0][0]).toBe('/api/v1/provider-profiles/lint');
    expect(calls('/provider-profiles')[0][0]).toBe('/api/v1/provider-profiles');
  });

  it('shows what the gateway found and imports nothing while there is an error', async () => {
    lintDiagnostics = [
      {
        source: 'github.yaml',
        profileId: 'github',
        field: 'id',
        message: "custom provider profile 'github' already exists",
        severity: 'error',
      },
    ];
    renderModal();
    choose(file('github.yaml', fixture('providers/github.yaml')));

    const table = await screen.findByTestId('profile-diagnostics');
    expect(table).toHaveTextContent(
      "errorgithub.yamlgithubidcustom provider profile 'github' already exists",
    );
    expect(submit()).toBeDisabled();
    fireEvent.click(submit());
    expect(calls('/provider-profiles')).toHaveLength(0);
  });

  // The gateway reports a warning and imports all the same, so a warning is
  // shown and does not stand in the way.
  it('lets an import through with warnings', async () => {
    lintDiagnostics = [
      {
        source: 'github.yaml',
        profileId: 'github',
        field: 'id',
        message:
          "profile 'github' shadows a platform-scoped profile in this workspace",
        severity: 'warning',
      },
    ];
    renderModal();
    choose(file('github.yaml', fixture('providers/github.yaml')));

    expect(await screen.findByTestId('profile-diagnostics')).toHaveTextContent(
      'shadows a platform-scoped profile',
    );
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // As in the CLI: a file that is not a profile stops the whole import, and
  // the files that are profiles are still checked.
  it('imports nothing when one of the files is not a profile', async () => {
    renderModal();
    choose(
      file('github.yaml', fixture('providers/github.yaml')),
      file(
        'no-id.yaml',
        fixture('examples/governance-interceptor/profiles/slack.yaml'),
      ),
      file('notes.txt', 'not a profile'),
    );

    const table = await screen.findByTestId('profile-diagnostics');
    expect(table).toHaveTextContent(
      'no-id.yaml-filefailed to parse provider profile YAML: missing field `id`',
    );
    expect(table).toHaveTextContent(
      'notes.txt-fileunsupported provider profile file format',
    );
    const files = screen.getByTestId('profile-files');
    expect(within(files).getAllByText('Not a profile')).toHaveLength(2);
    expect(within(files).getByText('GitHub (github)')).toBeVisible();

    await waitFor(() => expect(calls('/lint')).toHaveLength(1));
    expect(profilesOf(calls('/lint')[0]).map((p) => p.id)).toEqual(['github']);
    expect(submit()).toBeDisabled();
  });

  it('checks again when a file is taken out', async () => {
    renderModal();
    choose(
      file('github.yaml', fixture('providers/github.yaml')),
      file('notes.txt', 'not a profile'),
    );
    await screen.findByTestId('profile-diagnostics');
    expect(submit()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(calls('/lint')).toHaveLength(2);
    expect(screen.queryByTestId('profile-diagnostics')).not.toBeInTheDocument();
  });

  it('reads a file chosen again in place of the earlier reading', async () => {
    renderModal();
    choose(file('p.yaml', 'id: p\n'));
    expect(await screen.findByTestId('profile-diagnostics')).toHaveTextContent(
      'missing field `display_name`',
    );

    choose(file('p.yaml', 'id: p\ndisplay_name: P\n'));
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(screen.getByTestId('profile-files')).toHaveTextContent('P (p)');
    expect(screen.queryByTestId('profile-diagnostics')).not.toBeInTheDocument();
  });

  // The gateway checks again when it imports, and can refuse then: another
  // import may have got there first. Nothing was written, and it says why.
  it('shows why the gateway refused an import it had accepted', async () => {
    importDiagnostics = [
      {
        source: 'github.yaml',
        profileId: 'github',
        field: 'id',
        message: "custom provider profile 'github' already exists",
        severity: 'error',
      },
    ];
    renderModal();
    choose(file('github.yaml', fixture('providers/github.yaml')));
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());

    expect(
      await screen.findByText('The gateway did not import the profiles'),
    ).toBeVisible();
    expect(diagnostics()).toHaveTextContent('already exists');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(submit()).toBeDisabled();
  });

  it('says so when the gateway cannot check the profiles', async () => {
    mockPost.mockRejectedValue(new Error('platform admin role required'));
    renderModal(PLATFORM_PROFILE_SCOPE);
    choose(file('github.yaml', fixture('providers/github.yaml')));

    expect(
      await screen.findByText('The gateway could not check the profiles'),
    ).toBeVisible();
    expect(screen.getByText('platform admin role required')).toBeVisible();
    expect(submit()).toBeDisabled();
  });
});

describe('ProfileFileModal updating', () => {
  const stored: ProviderProfile = {
    id: 'github',
    displayName: 'GitHub',
    category: 'SOURCE_CONTROL',
    credentials: [
      {
        name: 'api_token',
        envVars: ['GITHUB_TOKEN'],
        required: true,
        authStyle: 'bearer',
        headerName: 'authorization',
      },
    ],
    inferenceCapable: false,
    resourceVersion: 4,
    source: 'user',
    scope: 'workspace',
    endpoints: ['api.github.com:443'],
    networkEndpoints: [
      {
        host: 'api.github.com',
        port: 443,
        protocol: 'rest',
        access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
        enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      },
    ],
    binaries: [{ path: '/usr/bin/gh' }],
  };

  // The round trip the CLI documents: export, edit, update. The file carries
  // the version it was exported at and the whole profile.
  it('sends the exported file back as the whole profile, at its version', async () => {
    const exported = serializeProfileFile(stored, 'yaml').replace(
      'display_name: GitHub',
      'display_name: GitHub Enterprise',
    );
    renderModal('team-a', stored);
    choose(file('github.yaml', exported));
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(submit()).toHaveTextContent('Update profile');
    fireEvent.click(submit());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    // An update is not linted first: to the gateway's lint a profile that
    // already exists is an error.
    expect(calls('/lint')).toHaveLength(0);
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [path, body] = mockPut.mock.calls[0];
    expect(path).toBe('/api/v1/workspaces/team-a/provider-profiles/github');
    expect(body).toEqual({
      expectedResourceVersion: 4,
      profile: {
        id: 'github',
        displayName: 'GitHub Enterprise',
        category: 'SOURCE_CONTROL',
        inferenceCapable: false,
        resourceVersion: 4,
        source: 'user',
        scope: 'workspace',
        importSource: 'github.yaml',
        credentials: stored.credentials,
        networkEndpoints: stored.networkEndpoints,
        binaries: stored.binaries,
      },
    });
    expect(onSuccess).toHaveBeenCalledWith('Profile "github" updated');
  });

  it('updates a platform profile in the platform scope', async () => {
    const platform: ProviderProfile = { ...stored, scope: 'platform' };
    renderModal(PLATFORM_PROFILE_SCOPE, platform);
    choose(file('github.json', serializeProfileFile(platform, 'json')));
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut.mock.calls[0][0]).toBe('/api/v1/provider-profiles/github');
  });

  it('refuses a file that is another profile', async () => {
    renderModal('team-a', stored);
    choose(file('openai.yaml', fixture('providers/openai.yaml')));

    expect(await screen.findByTestId('profile-diagnostics')).toHaveTextContent(
      'this file is profile "openai", not "github"',
    );
    expect(submit()).toBeDisabled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  // One id can be a workspace profile and the platform profile it shadows.
  // Both are listed, both export to a file of the same id, and after a first
  // import both are at the same resource version, so neither the id nor the
  // version tells the two files apart. The scope in the file does.
  it.each([
    ['workspace', 'platform', 'team-a'],
    ['platform', 'workspace', PLATFORM_PROFILE_SCOPE],
  ] as const)(
    'refuses to update the %s profile from a file exported from the %s one',
    async (targetScope, fileScope, scope) => {
      renderModal(scope, { ...stored, scope: targetScope });
      choose(
        file(
          'github.yaml',
          serializeProfileFile({ ...stored, scope: fileScope }, 'yaml'),
        ),
      );

      const found = await screen.findByTestId('profile-diagnostics');
      expect(found).toHaveTextContent(
        `this file is the ${fileScope} profile "github", and the profile being updated is the ${targetScope} one`,
      );
      expect(within(found).getByText('scope')).toBeInTheDocument();
      expect(submit()).toBeDisabled();
      fireEvent.click(submit());
      expect(mockPut).not.toHaveBeenCalled();
    },
  );

  // A file written by hand, or with the line taken out, says nothing about
  // where it came from. The id and the version are then all there is.
  it('takes a file that names no scope', async () => {
    renderModal('team-a', stored);
    const unscoped = serializeProfileFile(stored, 'yaml').replace(
      /^scope: .*\n/m,
      '',
    );
    expect(unscoped).not.toContain('scope:');
    choose(file('github.yaml', unscoped));

    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
  });

  it('reports a file of another id in another scope as both', async () => {
    renderModal('team-a', stored);
    choose(
      file(
        'openai.yaml',
        `${fixture('providers/openai.yaml')}scope: platform\n`,
      ),
    );

    const found = await screen.findByTestId('profile-diagnostics');
    expect(found).toHaveTextContent(
      'this file is profile "openai", not "github"',
    );
    expect(found).toHaveTextContent(
      'this file is the platform profile "openai", and the profile being updated is the workspace one',
    );
    expect(submit()).toBeDisabled();
  });

  // A file that was never exported has no version. The gateway refuses it
  // and says to export first; the dashboard does not supply a version for it,
  // which would let a stale file overwrite a newer profile.
  it('shows the gateway refusal for a file with no resource version', async () => {
    mockPut.mockResolvedValue({
      updated: false,
      diagnostics: [
        {
          source: 'github.yaml',
          profileId: 'github',
          field: 'resource_version',
          message:
            'custom provider profile update requires a non-zero resource_version; export the current profile before editing it',
          severity: 'error',
        },
      ],
    });
    renderModal('team-a', stored);
    choose(file('github.yaml', fixture('providers/github.yaml')));
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());

    expect(
      await screen.findByText('The gateway did not update the profile'),
    ).toBeVisible();
    expect(mockPut.mock.calls[0][1].expectedResourceVersion).toBeUndefined();
    expect(diagnostics()).toHaveTextContent(
      'export the current profile before editing it',
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('takes one file: the last one chosen', async () => {
    renderModal('team-a', stored);
    choose(file('github.yaml', serializeProfileFile(stored, 'yaml')));
    await waitFor(() => expect(submit()).toBeEnabled());
    choose(file('github-v2.yaml', serializeProfileFile(stored, 'yaml')));
    await waitFor(() =>
      expect(screen.getByTestId('profile-files')).toHaveTextContent(
        'github-v2.yaml',
      ),
    );
    expect(screen.getByTestId('profile-files')).not.toHaveTextContent(
      'github.yaml',
    );
  });
});
