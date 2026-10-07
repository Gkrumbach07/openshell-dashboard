import type {
  ProfileCredential,
  ProfileNetworkEndpoint,
  ProviderProfile,
} from '../types';
import {
  accessPresetName,
  profileCategoryName,
  refreshStrategyName,
} from './profileFile';
import {
  acceptedCredentialKeys,
  storedCredentialKey,
} from './providerCredentials';

// What the provider list and the provider detail say about a provider and the
// profile its type resolves to. The wording is the OpenShell TUI's, from
// ProviderListEntry and provider_detail_from_provider in
// crates/openshell-tui/src/app.rs at v0.1.2. `profile` is undefined for a
// provider whose type matches no profile, which the TUI calls unprofiled.
//
// One deliberate difference: the TUI counts a credential as present only when
// one of its env vars is stored, so a credential that declares none, and is
// stored under its own name, always reads as missing there. Here a credential
// is present under any key the gateway accepts for it.

const plural = (count: number): string => (count === 1 ? '' : 's');

// The name a profile goes by: its display name, or its id when it has none.
export const profileLabel = (profile: ProviderProfile): string =>
  profile.displayName || profile.id;

// What stands in for a profile name when a provider has no profile.
export const unprofiledLabel = (type: string): string => `${type} (unprofiled)`;

export const providerCategoryLabel = (
  profile: ProviderProfile | undefined,
): string => (profile ? profileCategoryName(profile.category) : 'legacy');

// "1/2 req, 3 keys": how many of the credentials the profile requires the
// provider holds, and how many keys it holds in all. Without a profile there
// is nothing to require.
export const credentialSummary = (
  profile: ProviderProfile | undefined,
  storedKeys: string[],
): string => {
  const stored = `${storedKeys.length} key${plural(storedKeys.length)}`;
  if (!profile) {
    return stored;
  }
  const required = profile.credentials.filter(
    (credential) => credential.required,
  );
  const present = required.filter(
    (credential) => storedCredentialKey(credential, storedKeys) !== undefined,
  );
  return `${present.length}/${required.length} req, ${stored}`;
};

// How many endpoints a profile has. The summaries are one to an endpoint and
// are there even when the endpoints themselves are not (see ProviderProfile).
const endpointCount = (profile: ProviderProfile): number =>
  (profile.networkEndpoints ?? profile.endpoints ?? []).length;

// "2 endpoints, 1 bin, inference": what the profile lets a sandbox with the
// provider attached reach, in numbers.
export const policySummary = (profile: ProviderProfile | undefined): string => {
  if (!profile) {
    return 'no profile';
  }
  const endpoints = endpointCount(profile);
  const binaries = (profile.binaries ?? []).length;
  const summary = `${endpoints} endpoint${plural(endpoints)}, ${binaries} bin${plural(binaries)}`;
  return profile.inferenceCapable ? `${summary}, inference` : summary;
};

// --- A profile endpoint, as one line of the Policy section ---

export const endpointAddress = (endpoint: ProfileNetworkEndpoint): string => {
  const ports = endpoint.port ? [endpoint.port] : (endpoint.ports ?? []);
  return ports.length > 0
    ? `${endpoint.host ?? ''}:${ports.join(',')}`
    : (endpoint.host ?? '');
};

// An endpoint that names no protocol is not inspected: plain TCP.
export const endpointProtocol = (endpoint: ProfileNetworkEndpoint): string =>
  endpoint.protocol || 'l4';

// The access preset an endpoint names. One that names none allows what its
// rules allow ("rules"), or says so some other way ("custom"); a preset this
// dashboard has no name for is "unknown".
export const endpointAccess = (endpoint: ProfileNetworkEndpoint): string => {
  const preset = accessPresetName(endpoint.access);
  if (preset === '') {
    return (endpoint.rules ?? []).length > 0 ? 'rules' : 'custom';
  }
  return preset.startsWith('unknown(') ? 'unknown' : preset;
};

// --- Refresh, as a profile declares it ---

export type ProfileRefreshSummary = {
  credential: string;
  strategy: string;
  scopes: string[];
  // How many inputs the refresh takes, such as a client id and a secret.
  materialKeys: number;
};

// The refresh each credential of a profile declares, for the credentials that
// declare one. This is the profile's metadata, not what is configured on a
// provider: that is its refresh status.
export const profileRefreshSummaries = (
  profile: ProviderProfile,
): ProfileRefreshSummary[] =>
  profile.credentials.flatMap((credential) =>
    credential.refresh
      ? [
          {
            credential: credential.name,
            strategy: refreshStrategyName(credential.refresh.strategy),
            scopes: credential.refresh.scopes ?? [],
            materialKeys: (credential.refresh.material ?? []).length,
          },
        ]
      : [],
  );

export const materialKeysLabel = (count: number): string =>
  `${count} key${plural(count)}`;

// --- A provider's credentials, as its profile declares them ---

export type CredentialRow = {
  // The credential's name, or the stored key for one no profile declares.
  name: string;
  // Absent for a stored key no profile declares.
  credential?: ProfileCredential;
  // The keys the gateway accepts the credential under.
  keys: string[];
  // Those of them the provider holds. None means the credential is missing.
  heldKeys: string[];
};

// One row for each credential the profile declares, held or not, and then one
// for each key the provider holds that the profile does not declare: without
// a profile that is every key it holds.
export const credentialRows = (
  profile: ProviderProfile | undefined,
  storedKeys: string[],
): CredentialRow[] => {
  const declared = (profile?.credentials ?? []).map((credential) => {
    const keys = acceptedCredentialKeys(credential);
    return {
      name: credential.name,
      credential,
      keys,
      heldKeys: keys.filter((key) => storedKeys.includes(key)),
    };
  });
  const declaredKeys = new Set(declared.flatMap((row) => row.keys));
  const undeclared = [...storedKeys]
    .filter((key) => !declaredKeys.has(key))
    .sort()
    .map((key) => ({ name: key, keys: [key], heldKeys: [key] }));
  return [...declared, ...undeclared];
};
