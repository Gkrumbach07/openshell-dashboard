import {
  PLATFORM_PROFILE_SCOPE,
  deleteProviderProfile,
  getProviderProfile,
  importProviderProfiles,
  lintProviderProfiles,
  listProviderProfiles,
  updateProviderProfile,
} from '../providers';
import { del, get, post, put } from '../client';
import type { ImportProfileRequest } from '../../types';

jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

const profile: ImportProfileRequest = {
  id: 'github',
  displayName: 'GitHub',
  category: 'SOURCE_CONTROL',
  inferenceCapable: false,
};

// Every profile call addresses a scope: a workspace, under the workspace, or
// the platform, at the top level. The platform scope is the CLI's --global.
describe.each([
  ['a workspace', 'team-a', '/api/v1/workspaces/team-a/provider-profiles'],
  ['the platform', PLATFORM_PROFILE_SCOPE, '/api/v1/provider-profiles'],
])('provider profile paths for %s', (_name, scope, base) => {
  beforeEach(() => jest.clearAllMocks());

  it('lists', async () => {
    await listProviderProfiles(scope);
    expect(get).toHaveBeenCalledWith(base);
  });

  it('gets one', async () => {
    await getProviderProfile(scope, 'github');
    expect(get).toHaveBeenCalledWith(`${base}/github`);
  });

  it('imports', async () => {
    await importProviderProfiles(scope, [profile]);
    expect(post).toHaveBeenCalledWith(base, { profiles: [profile] });
  });

  it('lints', async () => {
    await lintProviderProfiles(scope, [profile]);
    expect(post).toHaveBeenCalledWith(`${base}/lint`, { profiles: [profile] });
  });

  it('updates', async () => {
    await updateProviderProfile(scope, 'github', profile, 4);
    expect(put).toHaveBeenCalledWith(`${base}/github`, {
      profile,
      expectedResourceVersion: 4,
    });
  });

  it('deletes', async () => {
    await deleteProviderProfile(scope, 'github');
    expect(del).toHaveBeenCalledWith(`${base}/github`);
  });
});

// The platform scope is named by a constant that no workspace can be called:
// a workspace name is a DNS label. An empty workspace name is not the
// platform scope, here or in the BFF.
describe('the platform profile scope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not a name a workspace can have', () => {
    expect(PLATFORM_PROFILE_SCOPE).not.toMatch(
      /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
    );
  });

  it('is not what an empty workspace name addresses', async () => {
    await listProviderProfiles('');
    expect(get).toHaveBeenCalledWith('/api/v1/workspaces//provider-profiles');
  });
});
