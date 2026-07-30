// Small pure helpers shared across pages.

export const formatAge = (createdAtMs: number, nowMs: number = Date.now()): string => {
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

// Community sandbox image shorthand, mirroring the CLI's `--from <name>`:
// a bare name (no "/" or ":") resolves to the community registry. This is a
// naming convention — there is no list-images API.
export const COMMUNITY_REGISTRY = 'ghcr.io/nvidia/openshell-community/sandboxes';

export const resolveImage = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed && !trimmed.includes('/') && !trimmed.includes(':')) {
    return `${COMMUNITY_REGISTRY}/${trimmed}:latest`;
  }
  return trimmed;
};

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
