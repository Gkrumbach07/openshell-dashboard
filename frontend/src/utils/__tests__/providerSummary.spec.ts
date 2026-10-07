import {
  acceptedCredentialKeys,
  storedCredentialKey,
} from '../providerCredentials';
import {
  credentialRows,
  credentialSummary,
  endpointAccess,
  endpointAddress,
  endpointProtocol,
  materialKeysLabel,
  policySummary,
  profileLabel,
  profileRefreshSummaries,
  providerCategoryLabel,
  unprofiledLabel,
} from '../providerSummary';
import type { ProfileCredential, ProviderProfile } from '../../types';

const profile = (
  overrides: Partial<ProviderProfile> = {},
): ProviderProfile => ({
  id: 'acme',
  displayName: 'Acme',
  category: 'INFERENCE',
  credentials: [],
  inferenceCapable: false,
  resourceVersion: 1,
  ...overrides,
});

const credential = (
  name: string,
  overrides: Partial<ProfileCredential> = {},
): ProfileCredential => ({ name, required: false, ...overrides });

// What the gateway accepts a credential under: accepted_stored_keys in
// upstream's profiles.rs.
describe('acceptedCredentialKeys', () => {
  it.each([
    ['its env vars when it declares any', { envVars: ['A', 'B'] }, ['A', 'B']],
    ['its name when it declares none', {}, ['token']],
    ['its name when the list is empty', { envVars: [] }, ['token']],
  ])('is %s', (_name, overrides, want) => {
    expect(acceptedCredentialKeys(credential('token', overrides))).toEqual(
      want,
    );
  });
});

describe('storedCredentialKey', () => {
  const twoKeys = credential('token', { envVars: ['A', 'B'] });
  it.each([
    ['none when the provider holds neither', [], undefined],
    ['the one it holds', ['B'], 'B'],
    ['the first when it holds both', ['B', 'A'], 'A'],
    ['none for a key the credential does not accept', ['token'], undefined],
  ])('is %s', (_name, stored, want) => {
    expect(storedCredentialKey(twoKeys, stored)).toBe(want);
  });

  it('is the name for a credential stored under it', () => {
    expect(storedCredentialKey(credential('token'), ['token'])).toBe('token');
  });
});

// The PROFILE and CATEGORY columns of the TUI's provider list.
describe('profile and category labels', () => {
  it('names a profile by its display name, or its id without one', () => {
    expect(profileLabel(profile())).toBe('Acme');
    expect(profileLabel(profile({ displayName: '' }))).toBe('acme');
  });

  it('marks a type no profile matches', () => {
    expect(unprofiledLabel('claude')).toBe('claude (unprofiled)');
  });

  it.each([
    ['INFERENCE', 'inference'],
    ['AGENT', 'agent'],
    ['SOURCE_CONTROL', 'source_control'],
    ['MESSAGING', 'messaging'],
    ['DATA', 'data'],
    ['KNOWLEDGE', 'knowledge'],
    ['OTHER', 'other'],
    ['UNSPECIFIED', 'other'],
  ] as const)('spells the category %s as %s', (category, want) => {
    expect(providerCategoryLabel(profile({ category }))).toBe(want);
  });

  it('calls a provider without a profile legacy', () => {
    expect(providerCategoryLabel(undefined)).toBe('legacy');
  });
});

// The CREDS column: "<required present>/<required> req, <n> key(s)".
describe('credentialSummary', () => {
  const declared = profile({
    credentials: [
      credential('api_key', {
        envVars: ['API_KEY', 'API_KEY_ALT'],
        required: true,
      }),
      credential('subject', { required: true }),
      credential('extra', { envVars: ['EXTRA'] }),
    ],
  });

  it.each([
    ['nothing held', [], '0/2 req, 0 keys'],
    ['one required held', ['API_KEY'], '1/2 req, 1 key'],
    ['held under a later env var', ['API_KEY_ALT'], '1/2 req, 1 key'],
    // The TUI looks only at env vars and would say 0/2 here.
    ['held under the credential name', ['subject'], '1/2 req, 1 key'],
    [
      'all required and an optional one',
      ['API_KEY', 'subject', 'EXTRA'],
      '2/2 req, 3 keys',
    ],
    ['only an optional one', ['EXTRA'], '0/2 req, 1 key'],
    // One credential under both its keys is one credential and two keys.
    ['one credential twice', ['API_KEY', 'API_KEY_ALT'], '1/2 req, 2 keys'],
  ])('with %s', (_name, stored, want) => {
    expect(credentialSummary(declared, stored)).toBe(want);
  });

  it('counts only keys for a provider without a profile', () => {
    expect(credentialSummary(undefined, [])).toBe('0 keys');
    expect(credentialSummary(undefined, ['A'])).toBe('1 key');
    expect(credentialSummary(undefined, ['A', 'B'])).toBe('2 keys');
  });

  it('requires nothing of a profile with no required credential', () => {
    expect(credentialSummary(profile(), [])).toBe('0/0 req, 0 keys');
  });
});

// The POLICY column: "<n> endpoint(s), <n> bin(s)[, inference]".
describe('policySummary', () => {
  it.each([
    ['nothing', {}, '0 endpoints, 0 bins'],
    [
      'one of each',
      { networkEndpoints: [{ host: 'a' }], binaries: [{ path: '/bin/a' }] },
      '1 endpoint, 1 bin',
    ],
    [
      'several, and inference',
      {
        networkEndpoints: [{ host: 'a' }, { host: 'b' }],
        binaries: [{ path: '/bin/a' }, { path: '/bin/b' }, { path: '/bin/c' }],
        inferenceCapable: true,
      },
      '2 endpoints, 3 bins, inference',
    ],
    // A backend that cannot read endpoints whole still says where they point.
    [
      'endpoints as summaries only',
      { endpoints: ['a:443', 'b:443'] },
      '2 endpoints, 0 bins',
    ],
  ])('with %s', (_name, overrides, want) => {
    expect(policySummary(profile(overrides))).toBe(want);
  });

  it('has nothing to count without a profile', () => {
    expect(policySummary(undefined)).toBe('no profile');
  });
});

// One endpoint of the Policy section: "host:port protocol access [path]".
describe('profile endpoints', () => {
  it.each([
    ['a port', { host: 'a.example', port: 443 }, 'a.example:443'],
    [
      'several ports',
      { host: 'a.example', ports: [80, 443] },
      'a.example:80,443',
    ],
    ['no port', { host: 'a.example' }, 'a.example'],
  ])('addresses an endpoint with %s', (_name, endpoint, want) => {
    expect(endpointAddress(endpoint)).toBe(want);
  });

  it('calls an endpoint without a protocol l4', () => {
    expect(endpointProtocol({ host: 'a' })).toBe('l4');
    expect(endpointProtocol({ host: 'a', protocol: 'rest' })).toBe('rest');
  });

  it.each([
    ['a preset', { access: 'NETWORK_ACCESS_PRESET_READ_ONLY' }, 'read-only'],
    [
      'another preset',
      { access: 'NETWORK_ACCESS_PRESET_READ_WRITE' },
      'read-write',
    ],
    ['the full preset', { access: 'NETWORK_ACCESS_PRESET_FULL' }, 'full'],
    ['no preset and rules', { rules: [{ allow: { method: 'GET' } }] }, 'rules'],
    ['no preset and no rules', {}, 'custom'],
    [
      'the unspecified preset',
      { access: 'NETWORK_ACCESS_PRESET_UNSPECIFIED', rules: [] },
      'custom',
    ],
    ['a preset without a name', { access: 9 }, 'unknown'],
  ])('reads the access of an endpoint with %s', (_name, endpoint, want) => {
    expect(endpointAccess({ host: 'a', ...endpoint })).toBe(want);
  });
});

// The Refresh section: "<credential>: <strategy> scopes=[..] material=N key(s)".
describe('profileRefreshSummaries', () => {
  it('summarizes each credential that declares a refresh', () => {
    const declared = profile({
      credentials: [
        credential('plain'),
        credential('oauth', {
          refresh: {
            strategy: 'OAUTH2_REFRESH_TOKEN',
            scopes: ['a', 'b'],
            material: [
              { name: 'client_id', required: true, secret: false },
              { name: 'client_secret', required: true, secret: true },
            ],
          },
        }),
        credential('sts', { refresh: { strategy: 'AWS_STS_ASSUME_ROLE' } }),
        credential('odd', { refresh: { strategy: '42' } }),
      ],
    });
    expect(profileRefreshSummaries(declared)).toEqual([
      {
        credential: 'oauth',
        strategy: 'oauth2_refresh_token',
        scopes: ['a', 'b'],
        materialKeys: 2,
      },
      {
        credential: 'sts',
        strategy: 'aws_sts_assume_role',
        scopes: [],
        materialKeys: 0,
      },
      // A strategy this dashboard has no name for.
      {
        credential: 'odd',
        strategy: 'unspecified',
        scopes: [],
        materialKeys: 0,
      },
    ]);
  });

  it('is empty for a profile that declares none', () => {
    expect(profileRefreshSummaries(profile())).toEqual([]);
  });

  it('counts material keys in words', () => {
    expect(materialKeysLabel(0)).toBe('0 keys');
    expect(materialKeysLabel(1)).toBe('1 key');
    expect(materialKeysLabel(3)).toBe('3 keys');
  });
});

describe('credentialRows', () => {
  const declared = profile({
    credentials: [
      credential('api_key', {
        envVars: ['API_KEY', 'API_KEY_ALT'],
        required: true,
      }),
      credential('subject'),
    ],
  });

  it('has a row for each declared credential, held or not', () => {
    expect(credentialRows(declared, ['API_KEY_ALT'])).toEqual([
      {
        name: 'api_key',
        credential: declared.credentials[0],
        keys: ['API_KEY', 'API_KEY_ALT'],
        heldKeys: ['API_KEY_ALT'],
      },
      {
        name: 'subject',
        credential: declared.credentials[1],
        keys: ['subject'],
        heldKeys: [],
      },
    ]);
  });

  it('keeps every key a credential is held under', () => {
    expect(
      credentialRows(declared, ['API_KEY_ALT', 'API_KEY'])[0].heldKeys,
    ).toEqual(['API_KEY', 'API_KEY_ALT']);
  });

  it('adds the keys held that the profile does not declare', () => {
    expect(
      credentialRows(declared, ['subject', 'Z_STRAY', 'A_STRAY']).slice(2),
    ).toEqual([
      { name: 'A_STRAY', keys: ['A_STRAY'], heldKeys: ['A_STRAY'] },
      { name: 'Z_STRAY', keys: ['Z_STRAY'], heldKeys: ['Z_STRAY'] },
    ]);
  });

  it('is the keys a provider holds when it has no profile', () => {
    expect(credentialRows(undefined, ['B', 'A'])).toEqual([
      { name: 'A', keys: ['A'], heldKeys: ['A'] },
      { name: 'B', keys: ['B'], heldKeys: ['B'] },
    ]);
    expect(credentialRows(undefined, [])).toEqual([]);
  });
});
