// Small pure helpers shared across pages.

export const formatAge = (
  createdAtMs: number,
  nowMs: number = Date.now(),
): string => {
  if (!createdAtMs || createdAtMs > nowMs) {
    return '-';
  }
  const seconds = Math.floor((nowMs - createdAtMs) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

export const formatTimestamp = (ms?: number): string =>
  ms ? new Date(ms).toLocaleString() : '-';

export const formatUptime = (
  createdAtMs: number,
  nowMs: number = Date.now(),
): string => {
  if (!createdAtMs || createdAtMs > nowMs) {
    return '';
  }
  const seconds = Math.floor((nowMs - createdAtMs) / 1000);
  if (seconds < 60) {
    return `up ${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `up ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `up ${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `up ${days}d ${hours % 24}h`;
};

// Community sandbox image shorthand, mirroring the CLI's `--from <name>`:
// a bare name (no "/" or ":") resolves to the community registry. This is a
// naming convention — there is no list-images API.
export const COMMUNITY_REGISTRY =
  'ghcr.io/nvidia/openshell-community/sandboxes';

export const resolveImage = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed && !trimmed.includes('/') && !trimmed.includes(':')) {
    return `${COMMUNITY_REGISTRY}/${trimmed}:latest`;
  }
  return trimmed;
};

import type { NetworkPolicyRule, SandboxPhase } from '../types';

// ── Sandbox status ──

const STATUS_DOT_COLORS: Partial<Record<SandboxPhase, string>> = {
  READY: 'var(--pf-t--global--color--status--success--default)',
  ERROR: 'var(--pf-t--global--color--status--danger--default)',
  PROVISIONING: 'var(--pf-t--global--color--status--info--default)',
  DELETING: 'var(--pf-t--global--color--status--warning--default)',
};

export const getStatusDotColor = (phase: SandboxPhase): string =>
  STATUS_DOT_COLORS[phase] ??
  'var(--pf-t--global--color--status--custom--default)';

// ── Egress helpers ──

export const countEgressHosts = (
  policies: Record<string, NetworkPolicyRule>,
): number => {
  const hosts = new Set<string>();
  for (const rule of Object.values(policies)) {
    for (const ep of rule.endpoints ?? []) {
      if (ep.host) hosts.add(`${ep.host}:${ep.port ?? 443}`);
    }
  }
  return hosts.size;
};

export const getEnforcementLabel = (rule: NetworkPolicyRule): string => {
  const ep = rule.endpoints?.[0];
  if (!ep) return 'enforce';
  if (ep.advisorProposed) return 'advisor';
  return ep.enforcement ?? 'enforce';
};

export const getEnforcementColor = (
  mode: string,
): 'green' | 'blue' | 'grey' => {
  if (mode === 'enforce') return 'green';
  if (mode === 'observe' || mode === 'advisor') return 'blue';
  return 'grey';
};

// ── Labels ──

// Parses "key=value, key2=value2" into a label map. Returns null on
// malformed input so form fields can show a validation error.
export const parseLabels = (raw: string): Record<string, string> | null => {
  const labels: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) {
    return labels;
  }
  for (const pair of trimmed.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (!key?.trim() || rest.length === 0 || !rest.join('=').trim()) {
      return null;
    }
    labels[key.trim()] = rest.join('=').trim();
  }
  return labels;
};
