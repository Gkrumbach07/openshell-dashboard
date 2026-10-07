import { readFileSync } from 'fs';
import { join } from 'path';

import { parseProfileFile } from '../profileFile';
import {
  allowsEmptyProviderCredentials,
  allowsRuntimeProviderCredentials,
  credentialForKey,
  isOwnProfile,
  isRuntimeResolvable,
  profileForProvider,
  refreshCredentialKeys,
  refreshManagedKeys,
  requiredStaticCredentials,
} from '../providerProfiles';
import type { ProfileCredential, ProviderProfile } from '../../types';

// An upstream profile file as the profile the gateway would serve for it.
const upstream = (path: string): ProviderProfile => {
  const text = readFileSync(
    join(__dirname, 'fixtures', 'provider-profiles', path),
    'utf8',
  );
  const { profile } = parseProfileFile(text, 'yaml', path);
  if (!profile) {
    throw new Error(`${path} is not a profile`);
  }
  return {
    ...profile,
    credentials: profile.credentials ?? [],
    resourceVersion: 1,
    endpoints: undefined,
  };
};

const profileOf = (...credentials: ProfileCredential[]): ProviderProfile => ({
  id: 'p',
  displayName: 'P',
  category: 'OTHER',
  credentials,
  inferenceCapable: false,
  resourceVersion: 1,
});

const names = (credentials: ProfileCredential[]) =>
  credentials.map((credential) => credential.name);

// The rules are the gateway's, ported from upstream, and the profiles are
// upstream's own. The compat suite checks two of these outcomes against a real
// gateway (TestProviderWithoutCredentials): a minted credential needs no value
// and a typed one does.
describe('which credentials a provider has to be given', () => {
  it.each([
    // A token to type in: it cannot be created empty.
    ['providers/github.yaml', ['api_token'], false, false],
    ['providers/openai.yaml', ['api_key'], false, false],
    // One STS call mints all three. The key the refresh is on is minted, and
    // the other two are its further outputs, though each is required.
    ['providers/aws.yaml', [], true, true],
    ['providers/aws-s3.yaml', [], true, true],
    // Two optional credentials, each minted by the gateway.
    ['providers/google-cloud.yaml', [], true, true],
    // An optional credential obtained through a token grant.
    ['examples/spiffe-token-grant-demo/provider-profile.yaml', [], true, true],
    // The granted token is resolved at runtime, but the subject token it is
    // exchanged for has to be stored first.
    [
      'examples/spiffe-token-exchange-demo/provider-profile.yaml',
      ['subject_token'],
      false,
      false,
    ],
  ])(
    '%s needs %j up front',
    (path, needed, allowsEmpty, allowsRuntimeCredentials) => {
      const profile = upstream(path);
      expect(names(requiredStaticCredentials(profile))).toEqual(needed);
      expect(allowsEmptyProviderCredentials(profile)).toBe(allowsEmpty);
      expect(allowsRuntimeProviderCredentials(profile)).toBe(
        allowsRuntimeCredentials,
      );
    },
  );

  it('takes a provider with no credentials when the profile has none or only optional ones', () => {
    for (const profile of [
      profileOf(),
      profileOf({ name: 'token', required: false }),
    ]) {
      expect(allowsEmptyProviderCredentials(profile)).toBe(true);
      // Nothing is resolved at runtime, so "runtime credentials" would not
      // mean anything: the CLI refuses the flag for such a profile.
      expect(allowsRuntimeProviderCredentials(profile)).toBe(false);
    }
  });

  it.each([
    ['OAUTH2_REFRESH_TOKEN', true],
    ['OAUTH2_CLIENT_CREDENTIALS', true],
    ['GOOGLE_SERVICE_ACCOUNT_JWT', true],
    ['AWS_STS_ASSUME_ROLE', true],
    // Somebody else performs these, so the credential still has to be given.
    ['STATIC', false],
    ['EXTERNAL', false],
    ['UNSPECIFIED', false],
  ])('a credential refreshed by %s is minted: %s', (strategy, minted) => {
    const credential = { name: 'token', required: true, refresh: { strategy } };
    const profile = profileOf(credential);
    expect(isRuntimeResolvable(profile, credential)).toBe(minted);
    expect(allowsRuntimeProviderCredentials(profile)).toBe(minted);
  });

  it('does not count the outputs of a refresh nobody performs', () => {
    const profile = profileOf(
      {
        name: 'key',
        required: true,
        refresh: {
          strategy: 'EXTERNAL',
          additionalOutputs: [{ output: 'secret', credential: 'secret' }],
        },
      },
      { name: 'secret', required: true },
    );
    expect(names(requiredStaticCredentials(profile))).toEqual([
      'key',
      'secret',
    ]);
  });

  it('needs the one static credential next to a minted one', () => {
    const profile = profileOf(
      {
        name: 'minted',
        required: true,
        refresh: { strategy: 'OAUTH2_REFRESH_TOKEN' },
      },
      { name: 'typed', required: true },
    );
    expect(names(requiredStaticCredentials(profile))).toEqual(['typed']);
    expect(allowsRuntimeProviderCredentials(profile)).toBe(false);
  });
});

describe('refresh credential keys', () => {
  const google = upstream('providers/google-cloud.yaml');

  // A provider created with runtime credentials holds nothing yet, and
  // configuring refresh is how it comes to: the keys are the profile's.
  it('offers the keys the profile declares when the provider holds none', () => {
    expect(refreshCredentialKeys(google, [])).toEqual([
      'GCP_SA_ACCESS_TOKEN',
      'GCP_ADC_ACCESS_TOKEN',
    ]);
  });

  it('offers a held key once, and a held key the profile does not declare', () => {
    expect(
      refreshCredentialKeys(google, ['GCP_ADC_ACCESS_TOKEN', 'LEGACY_KEY']),
    ).toEqual(['GCP_SA_ACCESS_TOKEN', 'GCP_ADC_ACCESS_TOKEN', 'LEGACY_KEY']);
  });

  it('uses the variable a credential is already stored under', () => {
    const github = upstream('providers/github.yaml');
    expect(refreshCredentialKeys(github, [])).toEqual(['GITHUB_TOKEN']);
    expect(refreshCredentialKeys(github, ['GH_TOKEN'])).toEqual(['GH_TOKEN']);
  });

  it('offers what the provider holds when its profile is not known', () => {
    expect(refreshCredentialKeys(undefined, ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('finds the credential a key belongs to, by variable or by name', () => {
    expect(credentialForKey(google, 'GCP_ADC_ACCESS_TOKEN')?.name).toBe(
      'adc_token',
    );
    expect(credentialForKey(google, 'adc_token')?.name).toBe('adc_token');
    expect(credentialForKey(google, 'OTHER')).toBeUndefined();
    expect(credentialForKey(undefined, 'adc_token')).toBeUndefined();
  });
});

describe('which scope owns a profile', () => {
  it.each([
    ['workspace', 'workspace', true],
    ['platform', 'workspace', false],
    ['platform', 'platform', true],
    ['workspace', 'platform', false],
    // An interceptor's profile, which no scope owns.
    [undefined, 'workspace', false],
    ['', 'platform', false],
  ] as const)(
    'a %s profile listed in a %s is its own: %s',
    (scope, listedIn, own) => {
      expect(isOwnProfile({ ...profileOf(), scope }, listedIn)).toBe(own);
    },
  );
});

// What the gateway resolves a provider's type to, by the scope the provider
// names: scoped_type_profile_for_scope in upstream's
// crates/openshell-server/src/provider_profile_sources.rs at v0.1.2 (lines
// 432 to 453). A provider that names no scope gets the platform profile, or a
// profile no scope owns, and never one imported into its workspace; to the
// gateway such a provider has no profile.
describe('the profile a provider resolves to', () => {
  const scoped = (scope: string | undefined, displayName: string) => ({
    ...profileOf(),
    id: 'openai',
    displayName,
    scope,
  });
  const own = scoped('workspace', 'workspace import');
  const platform = scoped('platform', 'platform import');
  const vended = scoped('', 'interceptor');
  const other = { ...profileOf(), id: 'other', scope: 'platform' };

  const named = { type: 'openai', profileWorkspace: 'team-a' };
  const unnamed = { type: 'openai' };

  it.each([
    ['its workspace', 'only the workspace has one', named, [own], own],
    ['its workspace', 'only the platform has one', named, [platform], platform],
    ['its workspace', 'both have one', named, [platform, own], own],
    ['its workspace', 'no scope owns it', named, [vended], vended],
    ['no scope', 'only the platform has one', unnamed, [platform], platform],
    ['no scope', 'both have one', unnamed, [own, platform], platform],
    ['no scope', 'no scope owns it', unnamed, [vended], vended],
    // The one the gateway does not resolve.
    ['no scope', 'only the workspace has one', unnamed, [own], undefined],
    ['its workspace', 'nothing has one', named, [], undefined],
    ['no scope', 'nothing has one', unnamed, [], undefined],
  ])(
    'for a provider that names %s when %s',
    (_scope, _case, provider, listed, want) => {
      expect(profileForProvider([other, ...listed], provider)).toBe(want);
    },
  );

  it('reads an empty profile scope as none', () => {
    expect(
      profileForProvider([own], { type: 'openai', profileWorkspace: '' }),
    ).toBeUndefined();
  });
});

// The keys a provider update may not write: reject_refresh_owned_credential_
// updates in upstream's crates/openshell-server/src/grpc/provider.rs at
// v0.1.2 refuses the key of every refresh the gateway performs, and the keys
// of the further credentials that refresh mints.
describe('the credentials refresh manages', () => {
  const status = (credentialKey: string, strategy: string) => ({
    credentialKey,
    strategy,
    status: 'active',
  });

  it('is the key of each refresh the gateway performs', () => {
    expect(
      refreshManagedKeys(undefined, [
        status('A', 'OAUTH2_CLIENT_CREDENTIALS'),
        status('B', 'OAUTH2_REFRESH_TOKEN'),
        status('C', 'GOOGLE_SERVICE_ACCOUNT_JWT'),
        status('D', 'AWS_STS_ASSUME_ROLE'),
      ]),
    ).toEqual(['A', 'B', 'C', 'D']);
  });

  // The gateway takes a new value for these: somebody else refreshes them.
  it('is not the key of a static or external refresh', () => {
    expect(
      refreshManagedKeys(undefined, [
        status('A', 'STATIC'),
        status('B', 'EXTERNAL'),
        status('C', 'UNSPECIFIED'),
      ]),
    ).toEqual([]);
  });

  it('includes the credentials the same refresh mints', () => {
    // upstream's aws profile: one STS call yields all three.
    const aws = upstream('providers/aws.yaml');
    expect(
      refreshManagedKeys(aws, [
        status('AWS_ACCESS_KEY_ID', 'AWS_STS_ASSUME_ROLE'),
      ]).sort(),
    ).toEqual([
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ]);
  });

  it('is nothing when no refresh is configured', () => {
    expect(refreshManagedKeys(upstream('providers/aws.yaml'), [])).toEqual([]);
  });
});
