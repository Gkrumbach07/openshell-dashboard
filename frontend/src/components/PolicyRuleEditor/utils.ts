import type {
  NetworkEndpoint,
  NetworkPolicyRule,
  SandboxPolicy,
} from '../../types';

export type EndpointFormValues = {
  host: string;
  port: number;
  access: string;
  protocol: string;
  enforcement: string;
  binaryPath: string;
};

export const emptyEndpoint: EndpointFormValues = {
  host: '',
  port: 443,
  access: 'read-only',
  protocol: 'rest',
  enforcement: 'enforce',
  binaryPath: '',
};

export const policyToYaml = (policy: SandboxPolicy): string => {
  const lines: string[] = [];
  lines.push(`version: ${policy.version ?? 1}`);
  if (policy.filesystem) {
    lines.push('filesystem:');
    if (policy.filesystem.includeWorkdir !== undefined) {
      lines.push(`  includeWorkdir: ${policy.filesystem.includeWorkdir}`);
    }
    if (policy.filesystem.readOnly?.length) {
      lines.push('  readOnly:');
      policy.filesystem.readOnly.forEach((p) => lines.push(`    - ${p}`));
    }
    if (policy.filesystem.readWrite?.length) {
      lines.push('  readWrite:');
      policy.filesystem.readWrite.forEach((p) => lines.push(`    - ${p}`));
    }
  }
  if (policy.landlock?.compatibility) {
    lines.push('landlock:');
    lines.push(`  compatibility: ${policy.landlock.compatibility}`);
  }
  if (policy.process) {
    lines.push('process:');
    if (policy.process.runAsUser)
      lines.push(`  runAsUser: ${policy.process.runAsUser}`);
    if (policy.process.runAsGroup)
      lines.push(`  runAsGroup: ${policy.process.runAsGroup}`);
  }
  lines.push('networkPolicies:');
  const rules = policy.networkPolicies ?? {};
  if (Object.keys(rules).length === 0) {
    lines.push('  {}');
  } else {
    Object.entries(rules).forEach(([name, rule]) => {
      lines.push(`  ${name}:`);
      if (rule.endpoints?.length) {
        lines.push('    endpoints:');
        rule.endpoints.forEach((ep) => {
          lines.push(`      - host: ${ep.host || '*'}`);
          if (ep.port) lines.push(`        port: ${ep.port}`);
          if (ep.protocol) lines.push(`        protocol: ${ep.protocol}`);
          if (ep.enforcement)
            lines.push(`        enforcement: ${ep.enforcement}`);
          if (ep.access) lines.push(`        access: ${ep.access}`);
        });
      }
      if (rule.binaries?.length) {
        lines.push('    binaries:');
        rule.binaries.forEach((b) => lines.push(`      - path: ${b.path}`));
      }
    });
  }
  return lines.join('\n') + '\n';
};

export const endpointSummary = (ep: NetworkEndpoint): string => {
  const parts = [ep.host || '*'];
  if (ep.port) parts.push(String(ep.port));
  if (ep.access) parts.push(ep.access);
  if (ep.protocol) parts.push(ep.protocol);
  if (ep.enforcement) parts.push(ep.enforcement);
  return parts.join(':');
};

export const mergeRule = (
  existing: NetworkPolicyRule | undefined,
  incoming: NetworkPolicyRule,
): NetworkPolicyRule => {
  if (!existing) return incoming;
  return {
    endpoints: [...(existing.endpoints ?? []), ...(incoming.endpoints ?? [])],
    binaries:
      [...(existing.binaries ?? []), ...(incoming.binaries ?? [])].length > 0
        ? [...(existing.binaries ?? []), ...(incoming.binaries ?? [])]
        : undefined,
  };
};
