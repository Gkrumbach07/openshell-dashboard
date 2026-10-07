import type { ProfileCredential, Provider, ProviderProfile } from '../types';
import { credentialStorageKey } from './providerCredentials';

// A workspace's profile list can hold the same id twice: the profile imported
// into the workspace, and the platform profile it shadows, which the gateway
// lists as well. They are told apart by scope.
export const profileKey = (profile: ProviderProfile): string =>
  `${profile.scope ?? ''}/${profile.id}`;

const isWorkspaceProfile = (profile: ProviderProfile): boolean =>
  profile.scope === 'workspace';

// The Provider.profile_workspace that makes the gateway resolve this profile
// and no other. The gateway looks a provider's type up in the scope the
// provider names: the provider's own workspace resolves the profile imported
// into it, and no scope is the platform one, which resolves a platform or
// built-in profile even when a workspace profile shadows its id.
export const profileWorkspaceFor = (
  profile: ProviderProfile,
  workspace: string,
): string | undefined => (isWorkspaceProfile(profile) ? workspace : undefined);

// The profile the gateway resolves an existing provider's type to, which is
// the one that says which credentials the provider takes and what it lets a
// sandbox reach. It is scoped_type_profile_for_scope in upstream's
// crates/openshell-server/src/provider_profile_sources.rs at v0.1.2 (lines
// 432 to 453):
//
//   - A provider that names its workspace as the profile scope gets the
//     profile that workspace sees: its own when it has one of that id, else
//     the platform's, else one no scope owns (an interceptor's).
//   - A provider that names no scope gets the platform profile, or one no
//     scope owns, and never a profile imported into its workspace. When the
//     workspace's own is the only profile of that id, the gateway resolves
//     none (line 448): it checks none of the provider's credentials against a
//     profile and adds no policy for it. Such a provider is unprofiled, and
//     saying otherwise would show credentials and endpoints of a profile the
//     gateway does not apply to it.
export const profileForProvider = (
  profiles: ProviderProfile[],
  provider: Pick<Provider, 'type' | 'profileWorkspace'>,
): ProviderProfile | undefined => {
  const candidates = profiles.filter((profile) => profile.id === provider.type);
  const own = candidates.find(isWorkspaceProfile);
  const shared = candidates.find((profile) => !isWorkspaceProfile(profile));
  return provider.profileWorkspace ? (own ?? shared) : shared;
};

// Whether more than one profile in the list has this profile's id, in which
// case its label has to say which one it is.
export const isAmbiguousProfile = (
  profiles: ProviderProfile[],
  profile: ProviderProfile,
): boolean => profiles.filter((other) => other.id === profile.id).length > 1;

// --- Which credentials a provider has to be given ---
//
// The rules the gateway applies when a provider is created, and the CLI
// before it asks, ported from ProviderTypeProfile in upstream's
// crates/openshell-providers/src/profiles.rs at v0.1.2. The gateway decides;
// these let the form say the same thing first.

// The refresh strategies the gateway performs itself, minting the credential
// from material it was configured with. A static or external refresh is one
// somebody else performs.
const GATEWAY_MINTABLE = new Set([
  'OAUTH2_REFRESH_TOKEN',
  'OAUTH2_CLIENT_CREDENTIALS',
  'GOOGLE_SERVICE_ACCOUNT_JWT',
  'AWS_STS_ASSUME_ROLE',
]);

const isGatewayMintable = (credential: ProfileCredential): boolean =>
  credential.refresh !== undefined &&
  GATEWAY_MINTABLE.has(credential.refresh.strategy);

// The credentials another credential's refresh mints along with its own: one
// STS call yields an access key, a secret key and a session token.
const coMintedCredentialNames = (profile: ProviderProfile): Set<string> =>
  new Set(
    profile.credentials
      .filter(isGatewayMintable)
      .flatMap((credential) => credential.refresh?.additionalOutputs ?? [])
      .map((output) => output.credential),
  );

// Whether a credential gets its value at runtime instead of being given one:
// through a token grant, a refresh the gateway performs, or as a further
// output of such a refresh on another credential.
export const isRuntimeResolvable = (
  profile: ProviderProfile,
  credential: ProfileCredential,
): boolean =>
  credential.tokenGrant !== undefined ||
  isGatewayMintable(credential) ||
  coMintedCredentialNames(profile).has(credential.name);

// The credentials a provider of this profile cannot be created without: the
// required ones that nothing resolves at runtime.
export const requiredStaticCredentials = (
  profile: ProviderProfile,
): ProfileCredential[] =>
  profile.credentials.filter(
    (credential) =>
      credential.required && !isRuntimeResolvable(profile, credential),
  );

// Whether the gateway takes a provider of this profile with no credentials at
// all: when it has none to require, which includes a profile with no
// credentials and one whose credentials are all optional.
export const allowsEmptyProviderCredentials = (
  profile: ProviderProfile,
): boolean => requiredStaticCredentials(profile).length === 0;

// Whether creating a provider "with runtime credentials" means anything for
// this profile, which is when the CLI accepts --runtime-credentials: no
// required credential needs a value up front, and at least one credential is
// resolved at runtime.
export const allowsRuntimeProviderCredentials = (
  profile: ProviderProfile,
): boolean =>
  allowsEmptyProviderCredentials(profile) &&
  profile.credentials.some((credential) =>
    isRuntimeResolvable(profile, credential),
  );

// --- Refresh ---

// The profile credential a stored key belongs to: the one that declares it as
// an environment variable, or the one stored under its own name.
export const credentialForKey = (
  profile: ProviderProfile | undefined,
  key: string,
): ProfileCredential | undefined =>
  profile?.credentials.find(
    (credential) =>
      credential.name === key || (credential.envVars ?? []).includes(key),
  );

// The credential keys refresh can be configured for on a provider: the ones
// its profile declares, each under the key the gateway stores it at, and the
// ones it holds. A provider created with runtime credentials holds none, and
// configuring refresh is how its credentials come to exist, so the keys it
// holds are not the whole list.
export const refreshCredentialKeys = (
  profile: ProviderProfile | undefined,
  storedKeys: string[],
): string[] => {
  const declared = (profile?.credentials ?? []).map((credential) =>
    credentialStorageKey(credential, storedKeys),
  );
  return [...new Set([...declared, ...storedKeys])];
};

// The refresh status of one credential, as far as these rules read it.
type RefreshOf = { credentialKey: string; strategy: string };

// The credential keys a provider update may not write, because a refresh the
// gateway performs manages them: the key each such refresh is configured for,
// and the keys of the further credentials it mints. It is what
// reject_refresh_owned_credential_updates in upstream's
// crates/openshell-server/src/grpc/provider.rs at v0.1.2 (lines 325 to 362)
// refuses, with "credentials managed by provider refresh cannot be updated or
// deleted with provider update". A static or external refresh is performed by
// somebody else, and its credential still takes a new value.
//
// The gateway keeps the further keys with the refresh and does not report
// them. They are worked out here as it works them out when the refresh is
// configured (resolved_additional_output_keys in profiles.rs): each further
// output names a credential of the profile, and counts when that credential
// declares exactly one environment variable.
export const refreshManagedKeys = (
  profile: ProviderProfile | undefined,
  statuses: RefreshOf[],
): string[] => {
  const keys = new Set<string>();
  for (const status of statuses) {
    if (!GATEWAY_MINTABLE.has(status.strategy)) {
      continue;
    }
    keys.add(status.credentialKey);
    const outputs =
      credentialForKey(profile, status.credentialKey)?.refresh
        ?.additionalOutputs ?? [];
    for (const output of outputs) {
      const target = profile?.credentials.find(
        (credential) => credential.name === output.credential,
      );
      if (target?.envVars?.length === 1) {
        keys.add(target.envVars[0]);
      }
    }
  }
  return [...keys];
};

// --- Which scope owns a profile ---

// Whether a profile listed in a scope is that scope's own, and so one that
// can be changed or deleted there. A workspace lists the platform's profiles
// as well as its own and can change neither those nor the ones an interceptor
// vends, which no scope owns; the gateway refuses if asked.
export const isOwnProfile = (
  profile: ProviderProfile,
  scope: 'workspace' | 'platform',
): boolean => profile.scope === scope;
