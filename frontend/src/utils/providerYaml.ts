import type { Provider } from '../types';

// The provider object as YAML, for reading: the OpenShell TUI's "Object YAML"
// view. It is a port of provider_to_redacted_yaml in
// crates/openshell-tui/src/app.rs at v0.1.2 and prints what that prints, in
// that order: the name, the type, the credentials, the configuration, the
// credential expiry times when there are any, and the id, resource version
// and labels of the metadata.
//
// No credential value is printed, and none could be: the BFF returns the keys
// a provider holds and never a value. Every key is shown with the same
// placeholder, "<redacted>", as the TUI shows it.

export const REDACTED = '<redacted>';

// A string as a double-quoted YAML scalar, with the escapes the TUI writes.
const yamlScalar = (value: string): string => {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
};

// An expiry as the TUI prints a protobuf timestamp: RFC 3339 in UTC, with
// the fraction of a second only when there is one.
const timestamp = (ms: number): string => {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return String(ms);
  }
  const iso = date.toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
};

// The entries of a map in the order of their keys.
const sorted = <T>(map: Record<string, T> | undefined): [string, T][] =>
  Object.entries(map ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export const providerToRedactedYaml = (provider: Provider): string => {
  const lines = [
    `name: ${yamlScalar(provider.metadata.name)}`,
    `type: ${yamlScalar(provider.type)}`,
  ];

  const credentialKeys = [...(provider.credentialNames ?? [])].sort();
  if (credentialKeys.length === 0) {
    lines.push('credentials: {}');
  } else {
    lines.push('credentials:');
    for (const key of credentialKeys) {
      lines.push(`  ${key}: ${yamlScalar(REDACTED)}`);
    }
  }

  const config = sorted(provider.config);
  if (config.length === 0) {
    lines.push('config: {}');
  } else {
    lines.push('config:');
    for (const [key, value] of config) {
      lines.push(`  ${key}: ${yamlScalar(value)}`);
    }
  }

  const expiries = sorted(provider.credentialExpiresAtMs);
  if (expiries.length > 0) {
    lines.push('credential_expiration_times:');
    for (const [key, ms] of expiries) {
      lines.push(`  ${key}: ${timestamp(ms)}`);
    }
  }

  lines.push('metadata:');
  lines.push(`  id: ${yamlScalar(provider.metadata.id)}`);
  lines.push(`  resource_version: ${provider.metadata.resourceVersion}`);
  const labels = sorted(provider.metadata.labels);
  if (labels.length > 0) {
    lines.push('  labels:');
    for (const [key, value] of labels) {
      lines.push(`    ${key}: ${yamlScalar(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
};
