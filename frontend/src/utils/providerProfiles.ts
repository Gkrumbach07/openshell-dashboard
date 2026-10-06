import type { Provider, ProviderProfile } from '../types';

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
// the one that says which credentials the provider takes. A provider that
// names its workspace as the profile scope gets the workspace's own profile
// when there is one; a provider that names none gets the platform or built-in
// one.
export const profileForProvider = (
  profiles: ProviderProfile[],
  provider: Pick<Provider, 'type' | 'profileWorkspace'>,
): ProviderProfile | undefined => {
  const candidates = profiles.filter((profile) => profile.id === provider.type);
  const own = candidates.find(isWorkspaceProfile);
  const shared = candidates.find((profile) => !isWorkspaceProfile(profile));
  return provider.profileWorkspace ? (own ?? shared) : (shared ?? own);
};

// Whether more than one profile in the list has this profile's id, in which
// case its label has to say which one it is.
export const isAmbiguousProfile = (
  profiles: ProviderProfile[],
  profile: ProviderProfile,
): boolean => profiles.filter((other) => other.id === profile.id).length > 1;
