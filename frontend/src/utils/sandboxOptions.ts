import type { SandboxSpec, ServiceExposure } from '../types';

// One row of a key/value editor.
export type KeyValueRow = { key: string; value: string };

// Reads the rows of a key/value editor as a map. A row left entirely empty is
// skipped; a value without a key, or a key given twice, is an error because
// either would silently lose what was typed.
export const rowsToRecord = (
  rows: KeyValueRow[],
): { record: Record<string, string>; error?: string } => {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key && !row.value) {
      continue;
    }
    if (!key) {
      return { record, error: 'Every value needs a name' };
    }
    if (key in record) {
      return { record, error: `"${key}" is listed more than once` };
    }
    record[key] = row.value;
  }
  return { record };
};

// Reads the command field as an argv: one argument per line, each exactly as
// typed. No shell parses a sandbox's main command, so nothing is split on
// spaces or unquoted here either. Empty lines are skipped.
export const parseCommand = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');

// A command typed on one line the way it would be typed into a shell. It is
// sent as a single argument, which is almost never what was meant.
export const isUnsplitCommand = (argv: string[]): boolean =>
  argv.length === 1 && /\s/.test(argv[0]);

// Renders an argv on one line, quoting the arguments that would not read as
// one argument otherwise.
export const formatCommand = (argv: string[]): string =>
  argv
    .map((arg) =>
      arg === '' || /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg,
    )
    .join(' ');

// One row of the service exposure editor.
export type ServiceExposureRow = { service: string; port: string };

const MAX_PORT = 65535;

// Reads the rows of the service exposure editor. A row left entirely empty is
// skipped. The port has to be a port, and a name can be used once, the unnamed
// service included: the gateway refuses the whole create otherwise.
export const parseServiceExposures = (
  rows: ServiceExposureRow[],
): { exposures: ServiceExposure[]; error?: string } => {
  const exposures: ServiceExposure[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    const service = row.service.trim();
    const port = row.port.trim();
    if (!service && !port) {
      continue;
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > MAX_PORT) {
      return {
        exposures,
        error: `Port must be a whole number from 1 to ${MAX_PORT}`,
      };
    }
    if (names.has(service)) {
      return {
        exposures,
        error: service
          ? `Service "${service}" is listed more than once`
          : 'Only one service can be left without a name',
      };
    }
    names.add(service);
    exposures.push({
      ...(service ? { service } : {}),
      targetPort: Number(port),
    });
  }
  return { exposures };
};

// Reads the driver config field: empty for none, otherwise a JSON object keyed
// by compute driver name.
export const parseDriverConfig = (
  text: string,
): { value?: Record<string, unknown>; error?: string } => {
  if (!text.trim()) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      error: 'Driver config must be a JSON object keyed by driver name',
    };
  }
  return { value: parsed as Record<string, unknown> };
};

const DURATION_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

// Reads a duration the way `openshell sandbox template create --ready-within`
// does: a whole number and a unit of s, m or h, greater than zero. Returns
// undefined for an empty field and null for text that is not such a duration.
export const parseDurationMs = (text: string): number | null | undefined => {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(\d+)([smh])$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const ms = Number(match[1]) * DURATION_UNITS[match[2]];
  return ms > 0 && Number.isSafeInteger(ms) ? ms : null;
};

// Renders milliseconds in the largest unit that holds them exactly, as the CLI
// prints a template's startup deadline.
export const formatDurationMs = (ms: number): string => {
  if (ms % DURATION_UNITS.h === 0) {
    return `${ms / DURATION_UNITS.h}h`;
  }
  if (ms % DURATION_UNITS.m === 0) {
    return `${ms / DURATION_UNITS.m}m`;
  }
  if (ms % DURATION_UNITS.s === 0) {
    return `${ms / DURATION_UNITS.s}s`;
  }
  return `${ms}ms`;
};

// The CPU and memory quantities a sandbox was created with. They sit in the
// template's free-form `resources` under `limits` and `requests`, so each one
// is read only if it is there and is text.
export type SandboxResourceQuantities = {
  cpuLimit?: string;
  memoryLimit?: string;
  cpuRequest?: string;
  memoryRequest?: string;
};

const quantity = (section: unknown, key: string): string | undefined => {
  if (typeof section !== 'object' || section === null) {
    return undefined;
  }
  const value = (section as Record<string, unknown>)[key];
  if (typeof value === 'string' && value) {
    return value;
  }
  return typeof value === 'number' ? String(value) : undefined;
};

export const sandboxResourceQuantities = (
  spec: SandboxSpec,
): SandboxResourceQuantities => {
  const resources = spec.template?.resources ?? {};
  return {
    cpuLimit: quantity(resources.limits, 'cpu'),
    memoryLimit: quantity(resources.limits, 'memory'),
    cpuRequest: quantity(resources.requests, 'cpu'),
    memoryRequest: quantity(resources.requests, 'memory'),
  };
};

// How a GPU request reads: a count, the driver's own choice, or none.
export const formatGpuRequest = (spec: SandboxSpec): string => {
  if (spec.gpuCount !== undefined) {
    return String(spec.gpuCount);
  }
  return spec.gpu ? 'Driver default' : '-';
};

// The gateway keeps bookkeeping of its own in a sandbox's annotations, under
// this prefix (which compute driver runs it, the generation of its session).
const GATEWAY_ANNOTATION_PREFIX = 'internal.openshell.ai/';

// The annotations a sandbox was given, without the ones the gateway added for
// itself. Those are not the user's to read or set, and there are enough of
// them to push the user's own out of sight.
export const userAnnotations = (
  annotations: Record<string, string> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(annotations ?? {}).filter(
      ([key]) => !key.startsWith(GATEWAY_ANNOTATION_PREFIX),
    ),
  );
