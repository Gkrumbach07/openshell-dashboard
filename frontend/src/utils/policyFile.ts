import { LineCounter, isScalar, parseDocument, stringify, visit } from 'yaml';

import type {
  FilesystemPolicy,
  GraphqlOperation,
  L7Allow,
  L7QueryMatcher,
  L7Rule,
  LandlockPolicy,
  McpOptions,
  NetworkBinary,
  NetworkEndpoint,
  NetworkMiddlewareConfig,
  NetworkPolicyRule,
  ProcessPolicy,
  SandboxPolicy,
} from '../types';

// Policy files: the YAML document `openshell sandbox create --policy` and
// `openshell policy set --policy` read, and `openshell policy get --full`
// prints, and the JSON form of the same document that `-o json` prints. This
// module is the one place that knows both that file schema and the policy the
// BFF takes and returns (openshell.sandbox.v1.SandboxPolicy as protojson), and
// maps one to the other. The CLI does this itself, before it sends anything;
// so does the dashboard, and the BFF translates nothing.
//
// The schema and the mapping are upstream's at v0.1.2, ported by hand from
// crates/openshell-policy-schema/src/lib.rs (the serde types of the file, what
// may be left out and what it defaults to, and the check for unknown fields)
// and crates/openshell-policy/src/lib.rs (to_proto and from_proto, and what
// parse_sandbox_policy and serialize_sandbox_policy check on the way). What a
// file says differently from the API:
//
//   - `filesystem_policy` is the API's `filesystem`. Every other name is the
//     API's in snake case.
//   - tls, enforcement and access are names (`skip`, `enforce`, `read-only`);
//     the API carries enum values. `skip` is the only TLS mode there is: the
//     two the enum still lists are refused in both directions.
//   - A rule or a middleware that names itself nothing is named by its key.
//   - `port` is one port and `ports` several. The API gets both, `port` being
//     the first of `ports`. A file is written with whichever is shorter.
//   - A matcher is a bare string, its glob, or `{ any: [globs] }`.
//   - An MCP rule's `tool` is its `params.name`, and its other params may be
//     nested mappings, which the API holds flat under dotted keys.
//   - `mcp.max_body_bytes` and `json_rpc.max_body_bytes` are the API's one
//     `jsonRpcMaxBodyBytes`. An MCP endpoint that lists no `mcp.versions`
//     gets the pinned default, and the list is kept in upstream's order.
//   - When a policy is written, an MCP rule's method is left out where
//     upstream reads its absence as the same thing: `*` on a rule without a
//     tool, and `tools/call` on a rule with one when the endpoint allows all
//     known methods.
//   - `providerCredentialed` and `advisorProposed` are marks the gateway puts
//     on an endpoint. A file has no place for them and cannot set them.
//
// What is left to the gateway is everything upstream checks only once the
// policy reaches it (validate_sandbox_policy): whether hosts, paths, process
// identities and protocols are acceptable, and how the fields of an endpoint
// may be combined. Its message is shown as it is.
//
// Two things are refused here that upstream lets through, because each would
// change what a document says without saying so: a matcher that sets both a
// glob and a list (upstream writes the list and drops the glob), and a number
// in a middleware config that is not finite (upstream sends null).
//
// What upstream's parser refuses outright is refused here too, each with a
// diagnostic: an unknown field, a key written twice, a YAML merge key (`<<`),
// more than one document, a file over 4 MiB, and nesting deeper than 64
// levels. Nothing this module exports throws, whatever it is handed: it is
// fed text people paste, and the answer to any of it is a policy or a reason.

export type PolicyFileFormat = 'yaml' | 'json';

// What a document got wrong, and where. `message` says both, in upstream's
// words where it has any, and can be shown as it is. `path` is the field
// alone, in the spelling of the document it was found in, and is empty for the
// document as a whole.
export type PolicyFileDiagnostic = {
  path: string;
  message: string;
};

// What reading a policy file yields: the policy to send, unless the file could
// not be read as one, in which case why.
export type ParsedPolicyFile = {
  policy?: SandboxPolicy;
  diagnostics: PolicyFileDiagnostic[];
};

// What writing a policy yields: the text, unless the policy holds something a
// file cannot say, in which case what.
export type SerializedPolicy = {
  text?: string;
  diagnostics: PolicyFileDiagnostic[];
};

// --- Upstream's vocabulary ---

// A policy file is at most 4 MiB, and nests at most 64 levels deep
// (ParseLimits::default). Nothing a policy says needs more, and the second
// limit is also what makes reading any document at all safe here.
const MAX_POLICY_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const TOO_DEEP = `the document is nested deeper than ${MAX_DEPTH} levels`;

// The MCP protocol revisions upstream knows, in its order, and the one an
// endpoint accepts when it lists none. They are upstream's at v0.1.2 and move
// with it.
const MCP_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'];
const DEFAULT_MCP_VERSION = '2025-11-25';
const MCP_VERSION_REMEDIATION =
  'omit mcp.versions to use the pinned default revision, use an exact supported revision, or omit protocol and mcp for deliberate uninspected L4 passthrough only when that weaker boundary is acceptable';

const LANDLOCK_COMPATIBILITY = ['best_effort', 'hard_requirement'];

// An endpoint mode: the names a file gives its values and the names the API
// gives them, both in the order of the enum's numbers.
type EndpointMode = { file: string[]; api: string[] };

const TLS_MODE: EndpointMode = {
  file: ['', 'skip', 'terminate', 'passthrough'],
  api: [
    'NETWORK_TLS_MODE_UNSPECIFIED',
    'NETWORK_TLS_MODE_SKIP',
    'NETWORK_TLS_MODE_TERMINATE',
    'NETWORK_TLS_MODE_PASSTHROUGH',
  ],
};

const ENFORCEMENT_MODE: EndpointMode = {
  file: ['', 'enforce', 'audit'],
  api: [
    'NETWORK_ENFORCEMENT_MODE_UNSPECIFIED',
    'NETWORK_ENFORCEMENT_MODE_ENFORCE',
    'NETWORK_ENFORCEMENT_MODE_AUDIT',
  ],
};

const ACCESS_PRESET: EndpointMode = {
  file: ['', 'read-only', 'read-write', 'full'],
  api: [
    'NETWORK_ACCESS_PRESET_UNSPECIFIED',
    'NETWORK_ACCESS_PRESET_READ_ONLY',
    'NETWORK_ACCESS_PRESET_READ_WRITE',
    'NETWORK_ACCESS_PRESET_FULL',
  ],
};

// The TLS modes a policy may use. `terminate` and `passthrough` are still in
// the enum and are refused by upstream wherever a policy is read or written.
const isSupportedTls = (name: string): boolean =>
  name === '' || name === 'skip';

const unknownTls = (name: string): string =>
  `unknown tls value '${name}'; omit the field to keep automatic TLS termination`;

// The API's value for a mode a file names. The unspecified value is carried
// by leaving the field out.
const modeToApi = (mode: EndpointMode, name: string): string | undefined => {
  const index = mode.file.indexOf(name);
  return index > 0 ? mode.api[index] : undefined;
};

// The number of a mode the API returned, by name or as the number protojson
// writes for a value it has no name for. Undefined when it is neither.
const modeNumber = (
  mode: EndpointMode,
  value: string | number,
): number | undefined => {
  const index = typeof value === 'number' ? value : mode.api.indexOf(value);
  return Number.isInteger(index) && index >= 0 && index < mode.api.length
    ? index
    : undefined;
};

const isMcpProtocol = (protocol: string): boolean =>
  protocol.toLowerCase() === 'mcp';

// Upstream's order for a list of MCP revisions: the ones it knows in its own
// order, then any others by name. Nothing is removed, so a list that is wrong
// is still wrong afterwards.
const canonicalMcpVersions = (versions: string[]): string[] =>
  [...versions].sort((left, right) => {
    const a = MCP_VERSIONS.indexOf(left);
    const b = MCP_VERSIONS.indexOf(right);
    if (a >= 0 && b >= 0) {
      return a - b;
    }
    if (a >= 0 || b >= 0) {
      return a >= 0 ? -1 : 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });

// --- Reading a document ---

class PolicyFileError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type Doc = Record<string, unknown>;

const isMapping = (value: unknown): value is Doc =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const has = (doc: Doc, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(doc, key);

// Whether a value nests deeper than a policy document may. It looks one
// level at a time and at each thing once per level, so it has an answer for
// a value of any size, and for one that contains itself.
const isTooDeep = (value: unknown): boolean => {
  let level = new Set<unknown>([value]);
  for (let depth = 0; level.size > 0; depth += 1) {
    if (depth > MAX_DEPTH) {
      return true;
    }
    const next = new Set<unknown>();
    // Only what can nest further is carried to the next level.
    const add = (child: unknown) => {
      if (child !== null && typeof child === 'object') {
        next.add(child);
      }
    };
    level.forEach((item) => {
      if (Array.isArray(item)) {
        item.forEach(add);
      } else if (isMapping(item)) {
        Object.keys(item).forEach((key) => add(item[key]));
      }
    });
    level = next;
  }
  return false;
};

const describe = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'a list';
  }
  if (typeof value === 'object') {
    return 'a mapping';
  }
  if (typeof value === 'string') {
    return `string ${JSON.stringify(value)}`;
  }
  return `${typeof value === 'bigint' ? 'number' : typeof value} ${value}`;
};

const join = (path: string, key: string): string =>
  path ? `${path}.${key}` : key;

const mismatch = (path: string, expected: string, value: unknown): never => {
  throw new PolicyFileError(
    path,
    `expected ${expected}, found ${describe(value)}`,
  );
};

// A whole number, which a YAML document holds as a BigInt and a JSON one as a
// number. Upstream's reader takes a float that has no fraction for one too.
const toInteger = (value: unknown): number | undefined => {
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
};

// Where a document comes from decides two things about reading it. In a
// policy file a null is a value of the wrong type, and unknown fields were
// already looked for; in the API's JSON a null is a field that is not set,
// and the fields nothing asked for are collected as it is read.
type Source = {
  nullIsUnset: boolean;
  unknown?: string[];
};

const FILE: Source = { nullIsUnset: false };

// One mapping of a document, read field by field.
class Fields {
  private readonly read = new Set<string>();

  constructor(
    private readonly doc: Doc,
    readonly path: string,
    private readonly source: Source,
  ) {}

  static of(value: unknown, path: string, source: Source): Fields {
    if (!isMapping(value)) {
      mismatch(path, 'a mapping', value);
    }
    return new Fields(value as Doc, path, source);
  }

  at(key: string): string {
    return join(this.path, key);
  }

  // Whether the field is set.
  has(key: string): boolean {
    this.read.add(key);
    if (!has(this.doc, key) || this.doc[key] === undefined) {
      return false;
    }
    return !(this.source.nullIsUnset && this.doc[key] === null);
  }

  raw(key: string): unknown {
    return this.has(key) ? this.doc[key] : undefined;
  }

  // A string. Without a fallback the field is required.
  string(key: string, fallback?: string): string {
    if (!this.has(key)) {
      if (fallback === undefined) {
        throw new PolicyFileError(this.path, `missing field \`${key}\``);
      }
      return fallback;
    }
    const value = this.doc[key];
    return typeof value === 'string'
      ? value
      : mismatch(this.at(key), 'a string', value);
  }

  // A boolean, or undefined when the field is not set.
  optionalBoolean(key: string): boolean | undefined {
    if (!this.has(key)) {
      return undefined;
    }
    const value = this.doc[key];
    return typeof value === 'boolean'
      ? value
      : mismatch(this.at(key), 'true or false', value);
  }

  boolean(key: string): boolean {
    return this.optionalBoolean(key) ?? false;
  }

  // A whole number from `min` to `max`, or undefined when the field is not
  // set.
  optionalInteger(
    key: string,
    min: number,
    max: number,
    what: string,
  ): number | undefined {
    return this.has(key)
      ? integerIn(this.doc[key], this.at(key), min, max, what)
      : undefined;
  }

  // A list, each element converted by `each`. A missing list is empty.
  list<T>(
    key: string,
    each: (value: unknown, path: string, index: number) => T,
  ): T[] {
    if (!this.has(key)) {
      return [];
    }
    const value = this.doc[key];
    if (!Array.isArray(value)) {
      return mismatch(this.at(key), 'a list', value);
    }
    return value.map((element, index) =>
      each(element, `${this.at(key)}[${index}]`, index),
    );
  }

  strings(key: string): string[] {
    return this.list(key, (value, path) =>
      typeof value === 'string' ? value : mismatch(path, 'a string', value),
    );
  }

  // A mapping from names to values converted by `each`, as its entries in
  // the order of the names, which is the order upstream keeps a map in. A
  // missing mapping has none.
  entries<T>(
    key: string,
    each: (value: unknown, path: string, name: string) => T,
  ): [string, T][] {
    if (!this.has(key)) {
      return [];
    }
    const value = this.doc[key];
    if (!isMapping(value)) {
      return mismatch(this.at(key), 'a mapping', value);
    }
    return Object.keys(value)
      .sort()
      .map((name) => [name, each(value[name], join(this.at(key), name), name)]);
  }

  // A nested mapping, or undefined when the field is not set.
  optional<T>(key: string, convert: (fields: Fields) => T): T | undefined {
    return this.has(key)
      ? convert(Fields.of(this.doc[key], this.at(key), this.source))
      : undefined;
  }

  // Notes the fields nothing read, where they are being collected.
  done(): void {
    this.source.unknown?.push(
      ...Object.keys(this.doc)
        .filter((key) => !this.read.has(key))
        .map((key) => this.at(key)),
    );
  }
}

const integerIn = (
  value: unknown,
  path: string,
  min: number,
  max: number,
  what: string,
): number => {
  const number = toInteger(value);
  return number !== undefined && number >= min && number <= max
    ? number
    : mismatch(path, what, value);
};

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const I32_MIN = -0x80000000;
const I32_MAX = 0x7fffffff;

const PORT = `a port number from 0 to ${U16_MAX}`;
const BYTES = `a size in bytes from 0 to ${U32_MAX}`;

// Drops the fields of an object that hold nothing: empty text, empty lists
// and maps, false, zero and undefined. That is how the API carries a field
// that is not set, so what is read from a file is what the BFF would return
// for it. A field that is a message is added by its caller instead, because
// one that is set and empty is not one that is absent.
const compact = <T extends object>(value: Record<string, unknown>): T => {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!isEmpty(field)) {
      out[key] = field;
    }
  }
  return out as T;
};

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === '' ||
  value === false ||
  value === 0 ||
  (Array.isArray(value) && value.length === 0) ||
  (isMapping(value) && Object.keys(value).length === 0);

// --- A policy file to a policy ---

// The fields upstream's schema has, mapping by mapping. A field that is not
// among them is an error there, not a field that is ignored: a misspelt
// `enforcment` would otherwise be a policy that says less than its author
// thinks.
const ROOT_FIELDS = [
  'version',
  'filesystem_policy',
  'landlock',
  'process',
  'network_policies',
  'network_middlewares',
];
const ENDPOINT_FIELDS = [
  'host',
  'path',
  'port',
  'ports',
  'protocol',
  'tls',
  'enforcement',
  'access',
  'rules',
  'allowed_ips',
  'deny_rules',
  'allow_encoded_slash',
  'websocket_credential_rewrite',
  'request_body_credential_rewrite',
  'allow_uninspected_credentials',
  'persisted_queries',
  'graphql_persisted_queries',
  'graphql_max_body_bytes',
  'credential_signing',
  'signing_service',
  'signing_region',
  'credential_binding',
  'json_rpc',
  'mcp',
];
const MATCH_FIELDS = [
  'method',
  'path',
  'command',
  'query',
  'operation_type',
  'operation_name',
  'fields',
  'tool',
  'params',
];
const MIDDLEWARE_FIELDS = [
  'name',
  'middleware',
  'order',
  'config',
  'on_error',
  'endpoints',
];

// Upstream cuts a path short in a message at this length.
const MAX_UNKNOWN_FIELD_PATH = 1024;

const sequence = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const openMap = (value: unknown): [string, unknown][] =>
  isMapping(value) ? Object.entries(value) : [];

// findUnknownFields lists the fields of a policy document that the schema
// does not have, by path. It looks only at mappings that are where the schema
// expects one; anything of the wrong shape is reported when it is read. Two
// mappings are open and may hold any key: a middleware's `config`, and the
// nested parameter names of an MCP rule.
export const findUnknownFields = (document: unknown): string[] => {
  const unknown: string[] = [];
  // Refused for its depth where it is read; there is nothing to look for.
  if (isTooDeep(document)) {
    return unknown;
  }

  // Checks the keys of `value` when it is a mapping, and returns it.
  const closed = (
    value: unknown,
    path: string,
    allowed: string[],
  ): Doc | undefined => {
    if (!isMapping(value)) {
      return undefined;
    }
    for (const name of Object.keys(value)) {
      if (!allowed.includes(name)) {
        const full = join(path, name);
        unknown.push(
          full.length > MAX_UNKNOWN_FIELD_PATH
            ? `${full.slice(0, MAX_UNKNOWN_FIELD_PATH - 3)}...`
            : full,
        );
      }
    }
    return value;
  };

  const parameter = (value: unknown, path: string): void => {
    if (!isMapping(value)) {
      return;
    }
    const names = Object.keys(value);
    const isAnyMatcher =
      names.length === 1 &&
      Array.isArray(value.any) &&
      value.any.every((item) => typeof item === 'string');
    if (!isAnyMatcher) {
      names.forEach((name) => parameter(value[name], join(path, name)));
    }
  };

  const match = (value: unknown, path: string): void => {
    const rule = closed(value, path, MATCH_FIELDS);
    if (!rule) {
      return;
    }
    for (const [name, matcher] of openMap(rule.query)) {
      closed(matcher, join(join(path, 'query'), name), ['any']);
    }
    closed(rule.tool, join(path, 'tool'), ['any']);
    for (const [name, matcher] of openMap(rule.params)) {
      parameter(matcher, join(join(path, 'params'), name));
    }
  };

  const endpoint = (value: unknown, path: string): void => {
    const fields = closed(value, path, ENDPOINT_FIELDS);
    if (!fields) {
      return;
    }
    closed(fields.credential_binding, join(path, 'credential_binding'), [
      'provider',
    ]);
    closed(fields.json_rpc, join(path, 'json_rpc'), ['max_body_bytes']);
    closed(fields.mcp, join(path, 'mcp'), [
      'versions',
      'max_body_bytes',
      'strict_tool_names',
      'allow_all_known_mcp_methods',
    ]);
    for (const [name, operation] of openMap(fields.graphql_persisted_queries)) {
      closed(operation, join(join(path, 'graphql_persisted_queries'), name), [
        'operation_type',
        'operation_name',
        'fields',
      ]);
    }
    sequence(fields.rules).forEach((rule, index) => {
      const rulePath = join(path, `rules[${index}]`);
      const entry = closed(rule, rulePath, ['allow']);
      if (entry && has(entry, 'allow')) {
        match(entry.allow, join(rulePath, 'allow'));
      }
    });
    sequence(fields.deny_rules).forEach((deny, index) =>
      match(deny, join(path, `deny_rules[${index}]`)),
    );
  };

  const root = closed(document, '', ROOT_FIELDS);
  if (!root) {
    return unknown;
  }
  closed(root.filesystem_policy, 'filesystem_policy', [
    'include_workdir',
    'read_only',
    'read_write',
  ]);
  closed(root.landlock, 'landlock', ['compatibility']);
  closed(root.process, 'process', ['run_as_user', 'run_as_group']);
  for (const [name, value] of openMap(root.network_policies)) {
    const path = join('network_policies', name);
    const rule = closed(value, path, ['name', 'endpoints', 'binaries']);
    if (rule) {
      sequence(rule.endpoints).forEach((entry, index) =>
        endpoint(entry, join(path, `endpoints[${index}]`)),
      );
      sequence(rule.binaries).forEach((binary, index) =>
        closed(binary, join(path, `binaries[${index}]`), ['path']),
      );
    }
  }
  for (const [name, value] of openMap(root.network_middlewares)) {
    const path = join('network_middlewares', name);
    const middleware = closed(value, path, MIDDLEWARE_FIELDS);
    if (middleware) {
      closed(middleware.endpoints, join(path, 'endpoints'), [
        'include',
        'exclude',
      ]);
    }
  }
  return unknown;
};

// A query or tool matcher: a glob written bare, or a list of globs under
// `any`.
const readMatcher = (value: unknown, path: string): L7QueryMatcher => {
  if (typeof value === 'string') {
    return compact({ glob: value });
  }
  if (isMapping(value)) {
    const matcher = Fields.of(value, path, FILE);
    return compact({ any: matcher.strings('any') });
  }
  return mismatch(path, 'a glob or `{ any: [globs] }`', value);
};

// Whether a mapping under `params` is a matcher and not a level of nesting:
// it has no key but `any`, and `any` is a list of strings. Anything else is a
// mapping of parameter names, `any` among them if it comes to that.
const isAnyMatcher = (value: Doc): boolean =>
  Object.keys(value).every((key) => key === 'any') &&
  (!has(value, 'any') ||
    (Array.isArray(value.any) &&
      value.any.every((item) => typeof item === 'string')));

// Flattens one entry of `params` into the dotted keys the API holds them
// under. A key written twice, flat and nested, keeps the one that sorts last,
// as upstream's map does.
const flattenParam = (
  key: string,
  value: unknown,
  path: string,
  out: Map<string, L7QueryMatcher>,
): void => {
  if (typeof value === 'string' || (isMapping(value) && isAnyMatcher(value))) {
    out.set(key, readMatcher(value, path));
    return;
  }
  if (!isMapping(value)) {
    mismatch(
      path,
      'a glob, `{ any: [globs] }` or a mapping of nested parameters',
      value,
    );
    return;
  }
  for (const name of Object.keys(value).sort()) {
    flattenParam(`${key}.${name}`, value[name], join(path, name), out);
  }
};

// An allow or deny rule. `tool` is shorthand for the `name` entry of `params`
// and does not replace one that is already there.
const readMatch = (value: unknown, path: string): L7Allow => {
  const fields = Fields.of(value, path, FILE);
  const authored = fields.has('params') ? fields.raw('params') : {};
  if (!isMapping(authored)) {
    return mismatch(fields.at('params'), 'a mapping', authored);
  }
  const entries = Object.keys(authored).map(
    (name): [string, unknown, string] => [
      name,
      authored[name],
      join(fields.at('params'), name),
    ],
  );
  if (fields.has('tool')) {
    // Read whether or not it is used, so that a tool that is not a matcher
    // is reported where it was written.
    readMatcher(fields.raw('tool'), fields.at('tool'));
    if (!has(authored, 'name')) {
      entries.push(['name', fields.raw('tool'), fields.at('tool')]);
    }
  }
  const params = new Map<string, L7QueryMatcher>();
  entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .forEach(([name, entry, entryPath]) =>
      flattenParam(name, entry, entryPath, params),
    );
  return compact({
    method: fields.string('method', ''),
    path: fields.string('path', ''),
    command: fields.string('command', ''),
    query: Object.fromEntries(fields.entries('query', readMatcher)),
    operationType: fields.string('operation_type', ''),
    operationName: fields.string('operation_name', ''),
    fields: fields.strings('fields'),
    params: Object.fromEntries(params),
  });
};

const readGraphqlOperation = (
  value: unknown,
  path: string,
): GraphqlOperation => {
  const fields = Fields.of(value, path, FILE);
  return compact({
    operationType: fields.string('operation_type', ''),
    operationName: fields.string('operation_name', ''),
    fields: fields.strings('fields'),
  });
};

// The `mcp` mapping of an endpoint as it is written.
type McpStanza = {
  versions?: string[];
  maxBodyBytes: number;
  strictToolNames?: boolean;
  allowAllKnownMcpMethods?: boolean;
};

const readMcpStanza = (fields: Fields): McpStanza => ({
  // Whether the list is there matters: left out it is the default, and
  // written empty it is a mistake.
  versions: fields.has('versions') ? fields.strings('versions') : undefined,
  maxBodyBytes:
    fields.optionalInteger('max_body_bytes', 0, U32_MAX, BYTES) ?? 0,
  strictToolNames: fields.optionalBoolean('strict_tool_names'),
  allowAllKnownMcpMethods: fields.optionalBoolean(
    'allow_all_known_mcp_methods',
  ),
});

// What is wrong with the MCP revisions an endpoint lists, if anything: the
// first thing, as upstream reports it.
const mcpVersionsProblem = (
  versions: string[],
  context: string,
): string | undefined => {
  if (versions.length === 0) {
    return `${context} has an empty mcp.versions list; omit it to use the pinned default revision`;
  }
  const seen = new Set<string>();
  for (const version of versions) {
    if (!MCP_VERSIONS.includes(version)) {
      return `${context}: unsupported MCP protocol version '${version}'; ${MCP_VERSION_REMEDIATION}`;
    }
    if (seen.has(version)) {
      return `${context} has duplicate protocol version '${version}'`;
    }
    seen.add(version);
  }
  return undefined;
};

// The rule an endpoint belongs to, for the messages about it: its key, and
// the name it goes by.
type RuleContext = { key: string; name: string };

const readEndpoint = (
  value: unknown,
  path: string,
  index: number,
  rule: RuleContext,
  problems: PolicyFileDiagnostic[],
): NetworkEndpoint => {
  const fields = Fields.of(value, path, FILE);
  const host = fields.string('host', '');
  const protocol = fields.string('protocol', '');
  const isMcp = isMcpProtocol(protocol);

  const tls = fields.string('tls', '');
  const enforcement = fields.string('enforcement', '');
  const access = fields.string('access', '');
  const modeProblem = (key: string, message: string) =>
    problems.push({
      path: fields.at(key),
      message: `network policy '${rule.key}': endpoint ${index}: ${message}`,
    });
  if (!isSupportedTls(tls)) {
    modeProblem('tls', unknownTls(tls));
  }
  if (!ENFORCEMENT_MODE.file.includes(enforcement)) {
    modeProblem(
      'enforcement',
      `unknown enforcement value '${enforcement}' (expected enforce or audit)`,
    );
  }
  if (!ACCESS_PRESET.file.includes(access)) {
    modeProblem(
      'access',
      `unknown access value '${access}' (expected read-only, read-write, or full)`,
    );
  }

  // `ports` is the list when it has any, and else `port` is its one entry.
  const single = fields.optionalInteger('port', 0, U16_MAX, PORT) ?? 0;
  const several = fields.list('ports', (port, portPath) =>
    integerIn(port, portPath, 0, U16_MAX, PORT),
  );
  const ports = several.length > 0 ? several : single > 0 ? [single] : [];

  const mcp = fields.optional('mcp', readMcpStanza);
  const jsonRpc = fields.optional('json_rpc', (stanza) =>
    stanza.optionalInteger('max_body_bytes', 0, U32_MAX, BYTES),
  );
  if (mcp && !isMcp) {
    problems.push({
      path: fields.at('mcp'),
      message: `network policy '${rule.name}': non-MCP endpoint '${host}' cannot configure mcp options`,
    });
  } else if (mcp?.versions) {
    const problem = mcpVersionsProblem(
      mcp.versions,
      `network policy '${rule.name}'`,
    );
    if (problem) {
      problems.push({
        path: join(fields.at('mcp'), 'versions'),
        message: problem,
      });
    }
  }

  const endpoint = compact<NetworkEndpoint>({
    host,
    port: ports[0],
    protocol,
    tls: modeToApi(TLS_MODE, tls),
    enforcement: modeToApi(ENFORCEMENT_MODE, enforcement),
    access: modeToApi(ACCESS_PRESET, access),
    rules: fields.list('rules', (entry, rulePath): L7Rule => {
      const rule = Fields.of(entry, rulePath, FILE);
      if (!rule.has('allow')) {
        missing(rulePath, 'allow');
      }
      return { allow: readMatch(rule.raw('allow'), join(rulePath, 'allow')) };
    }),
    allowedIps: fields.strings('allowed_ips'),
    ports,
    denyRules: fields.list('deny_rules', readMatch),
    allowEncodedSlash: fields.boolean('allow_encoded_slash'),
    persistedQueries: fields.string('persisted_queries', ''),
    graphqlPersistedQueries: Object.fromEntries(
      fields.entries('graphql_persisted_queries', readGraphqlOperation),
    ),
    graphqlMaxBodyBytes:
      fields.optionalInteger('graphql_max_body_bytes', 0, U32_MAX, BYTES) ?? 0,
    path: fields.string('path', ''),
    websocketCredentialRewrite: fields.boolean('websocket_credential_rewrite'),
    requestBodyCredentialRewrite: fields.boolean(
      'request_body_credential_rewrite',
    ),
    credentialSigning: fields.string('credential_signing', ''),
    signingService: fields.string('signing_service', ''),
    signingRegion: fields.string('signing_region', ''),
    // The API has one body limit for both protocols. The MCP mapping decides
    // it whenever there is one, even one that sets no limit.
    jsonRpcMaxBodyBytes: mcp ? mcp.maxBodyBytes : (jsonRpc ?? 0),
  });
  if (isMcp) {
    // Always there on an MCP endpoint, with the revisions it accepts.
    const options: McpOptions = {};
    if (mcp?.strictToolNames !== undefined) {
      options.strictToolNames = mcp.strictToolNames;
    }
    if (mcp?.allowAllKnownMcpMethods !== undefined) {
      options.allowAllKnownMcpMethods = mcp.allowAllKnownMcpMethods;
    }
    options.versions = canonicalMcpVersions(
      mcp?.versions ?? [DEFAULT_MCP_VERSION],
    );
    endpoint.mcp = options;
  }
  const binding = fields.optional('credential_binding', (entry) =>
    compact<{ provider?: string }>({ provider: entry.string('provider') }),
  );
  if (binding) {
    endpoint.credentialBinding = binding;
  }
  if (fields.boolean('allow_uninspected_credentials')) {
    endpoint.allowUninspectedCredentials = true;
  }
  return endpoint;
};

const missing = (path: string, key: string): never => {
  throw new PolicyFileError(path, `missing field \`${key}\``);
};

const readBinary = (value: unknown, path: string): NetworkBinary =>
  compact({ path: Fields.of(value, path, FILE).string('path') });

const readRule = (
  value: unknown,
  path: string,
  key: string,
  problems: PolicyFileDiagnostic[],
): NetworkPolicyRule => {
  const fields = Fields.of(value, path, FILE);
  const name = fields.string('name', '') || key;
  return compact({
    name,
    endpoints: fields.list('endpoints', (endpoint, endpointPath, index) =>
      readEndpoint(endpoint, endpointPath, index, { key, name }, problems),
    ),
    binaries: fields.list('binaries', readBinary),
  });
};

const I64_MIN = BigInt('-9223372036854775808');
const I64_MAX = BigInt('9223372036854775807');

const digitsOf = (value: bigint): number =>
  String(value).replace('-', '').length;

const notJsonNumber = (path: string, what: string): PolicyFileError =>
  new PolicyFileError(
    path,
    `failed to convert network middleware config: ${what} is not a number JSON can hold`,
  );

// A value of a middleware's config, which is any JSON. The API holds every
// number as a double, so a whole number a double cannot hold is refused, as
// upstream refuses it, and not rounded.
const readConfigValue = (value: unknown, path: string): unknown => {
  if (typeof value === 'bigint') {
    const number = Number(value);
    // Upstream holds a whole number in 64 bits, and refuses one a double
    // cannot hold exactly. A number too large for 64 bits it reads as a
    // float, the nearest double there is, and nothing is exact about that.
    const fitsI64 = value >= I64_MIN && value <= I64_MAX;
    if (fitsI64 && BigInt(number) !== value) {
      throw new PolicyFileError(
        path,
        `failed to convert network middleware config: JSON number ${value} cannot be represented exactly as a protobuf double`,
      );
    }
    if (!Number.isFinite(number)) {
      throw notJsonNumber(path, `a whole number of ${digitsOf(value)} digits`);
    }
    return number;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw notJsonNumber(path, String(value));
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      readConfigValue(item, `${path}[${index}]`),
    );
  }
  if (isMapping(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        readConfigValue(item, join(path, name)),
      ]),
    );
  }
  return value ?? null;
};

const readMiddleware = (
  value: unknown,
  path: string,
  key: string,
): NetworkMiddlewareConfig => {
  const fields = Fields.of(value, path, FILE);
  const middleware = compact<NetworkMiddlewareConfig>({
    name: fields.string('name', '') || key,
    middleware: fields.string('middleware'),
  });
  // Always there, as upstream sends it, with or without anything in it.
  middleware.config = Object.fromEntries(
    fields.entries('config', readConfigValue),
  );
  const onError = fields.string('on_error', '');
  if (onError) {
    middleware.onError = onError;
  }
  const endpoints = fields.optional('endpoints', (selector) =>
    compact<{ include?: string[]; exclude?: string[] }>({
      include: selector.strings('include'),
      exclude: selector.strings('exclude'),
    }),
  );
  if (endpoints) {
    middleware.endpoints = endpoints;
  }
  const order = fields.optionalInteger(
    'order',
    I32_MIN,
    I32_MAX,
    'a whole number',
  );
  if (order) {
    middleware.order = order;
  }
  return middleware;
};

// At most this many unknown fields are listed one by one.
const MAX_UNKNOWN_FIELDS = 10;

const unknownFieldDiagnostics = (
  unknown: string[],
  message: (path: string) => string,
): PolicyFileDiagnostic[] => {
  const listed = unknown
    .slice(0, MAX_UNKNOWN_FIELDS)
    .map((path) => ({ path, message: message(path) }));
  const rest = unknown.length - listed.length;
  return rest > 0
    ? [...listed, { path: '', message: `and ${rest} more unknown fields` }]
    : listed;
};

// policyFromDocument converts a policy document, the parsed content of a
// policy file, to the policy the BFF takes: what upstream's to_proto makes of
// it, as the API's JSON. A document that is not a policy file yields no
// policy and the reasons.
export const policyFromDocument = (document: unknown): ParsedPolicyFile => {
  const problems: PolicyFileDiagnostic[] = [];
  try {
    if (isTooDeep(document)) {
      throw new PolicyFileError('', TOO_DEEP);
    }
    const unknown = findUnknownFields(document);
    if (unknown.length > 0) {
      return {
        diagnostics: unknownFieldDiagnostics(
          unknown,
          (path) => `unknown field '${path}' in authored policy`,
        ),
      };
    }
    const root = Fields.of(document, '', FILE);
    if (!root.has('version')) {
      missing('', 'version');
    }
    const version = integerIn(
      root.raw('version'),
      'version',
      0,
      U32_MAX,
      'a whole number',
    );
    if (version !== 1) {
      problems.push({
        path: 'version',
        message: `unsupported policy version ${version}; expected version 1`,
      });
    }
    const policy: SandboxPolicy = { version };
    const filesystem = root.optional('filesystem_policy', (fields) =>
      compact<FilesystemPolicy>({
        includeWorkdir: fields.boolean('include_workdir'),
        readOnly: fields.strings('read_only'),
        readWrite: fields.strings('read_write'),
      }),
    );
    if (filesystem) {
      policy.filesystem = filesystem;
    }
    const landlock = root.optional('landlock', (fields): LandlockPolicy => {
      const compatibility = fields.string('compatibility', 'best_effort');
      if (!LANDLOCK_COMPATIBILITY.includes(compatibility)) {
        throw new PolicyFileError(
          fields.at('compatibility'),
          `unknown variant \`${compatibility}\`, expected \`best_effort\` or \`hard_requirement\``,
        );
      }
      return { compatibility };
    });
    if (landlock) {
      policy.landlock = landlock;
    }
    const process = root.optional('process', (fields) =>
      compact<ProcessPolicy>({
        runAsUser: fields.string('run_as_user', ''),
        runAsGroup: fields.string('run_as_group', ''),
      }),
    );
    if (process) {
      policy.process = process;
    }
    const rules = root.entries('network_policies', (value, path, key) =>
      readRule(value, path, key, problems),
    );
    if (rules.length > 0) {
      policy.networkPolicies = Object.fromEntries(rules);
    }
    const middlewares = root.entries('network_middlewares', readMiddleware);
    if (middlewares.length > 0) {
      policy.networkMiddlewares = Object.fromEntries(middlewares);
    }
    return problems.length > 0
      ? { diagnostics: problems }
      : { policy, diagnostics: [] };
  } catch (error) {
    // Whatever the document is, the answer is a diagnostic and never an
    // exception: this is fed text people paste.
    const path = error instanceof PolicyFileError ? error.path : '';
    return {
      diagnostics: [
        ...problems,
        {
          path,
          message: `failed to decode sandbox policy fields: ${path ? `${path}: ` : ''}${reasonOf(error)}`,
        },
      ],
    };
  }
};

// The length of a text in UTF-8, which is what the size limit counts.
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit < 0xdc00) {
      // A surrogate pair is one character of four bytes.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

// What went wrong, in a sentence, whatever was thrown.
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Why a text is not a document. `refused` is something upstream's parser
// refuses on purpose, a key written twice or a text that is too long, and
// `syntax` is anything else.
class PolicySyntaxError extends Error {
  constructor(
    message: string,
    readonly kind: 'syntax' | 'refused' = 'syntax',
  ) {
    super(message);
  }
}

// loadPolicyDocument parses the text of a policy file to the document it
// holds. It reads the way upstream's parser is set up to: YAML 1.2, so that
// `no` is a string and `2025-11-25` is not a date; one document; a key
// written twice is an error, and so is a merge key. JSON is YAML, and is read
// by the same parser.
const loadPolicyDocument = (text: string): unknown => {
  // Counted only for a text long enough that it could be over.
  if (
    text.length * 3 > MAX_POLICY_BYTES &&
    utf8Length(text) > MAX_POLICY_BYTES
  ) {
    throw new PolicySyntaxError(
      `policy exceeds the ${MAX_POLICY_BYTES}-byte input limit`,
      'refused',
    );
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    merge: false,
    uniqueKeys: true,
    stringKeys: true,
    // A whole number is kept exact, so that one a middleware config cannot
    // hold is noticed and not rounded.
    intAsBigInt: true,
    lineCounter,
  });
  const failure = document.errors[0];
  if (failure) {
    // The first line says what and where; the rest draws the line it is on.
    throw new PolicySyntaxError(
      failure.message.split('\n')[0].replace(/:$/, ''),
      failure.code === 'DUPLICATE_KEY' ? 'refused' : 'syntax',
    );
  }
  // A merge key is `<<` written bare, anywhere a key can be. Upstream's
  // parser refuses one. Read as an ordinary key it would be an unknown field
  // in most places, and in a map of names (a rule, a query parameter, a
  // middleware's config) it would be an entry called `<<`, with the fields
  // its author meant to merge in left out and nothing said.
  visit(document, {
    Pair(_key, pair) {
      const key = pair.key;
      if (isScalar(key) && key.value === '<<' && key.type === 'PLAIN') {
        const { line, col } = lineCounter.linePos(key.range?.[0] ?? 0);
        throw new PolicySyntaxError(
          `merge key \`<<\` at line ${line}, column ${col}: a policy file may not use YAML merge keys; write the fields out`,
          'refused',
        );
      }
    },
  });
  let loaded: unknown;
  try {
    loaded = document.toJS();
  } catch (error) {
    // More aliases than the parser will follow.
    throw new PolicySyntaxError(reasonOf(error));
  }
  if (isTooDeep(loaded)) {
    throw new PolicySyntaxError(TOO_DEEP, 'refused');
  }
  return loaded;
};

const syntaxDiagnostic = (error: unknown): ParsedPolicyFile => ({
  diagnostics: [
    {
      path: '',
      message: `failed to parse sandbox policy YAML: ${reasonOf(error)}`,
    },
  ],
});

// parsePolicyFile reads a policy file, in YAML or in the JSON form of the same
// document: what `openshell sandbox create --policy` does with one before it
// sends anything. The policy it returns is the one the CLI would send.
export const parsePolicyFile = (text: string): ParsedPolicyFile => {
  try {
    return policyFromDocument(loadPolicyDocument(text));
  } catch (error) {
    return syntaxDiagnostic(error);
  }
};

// --- A policy to a policy file ---

// Adds a field to a document when upstream would write it: always, or only
// when it holds something.
const put = (doc: Doc, key: string, value: unknown, always = false): void => {
  if (always || !isEmpty(value)) {
    doc[key] = value;
  }
};

// A matcher as a file writes it: its list under `any` when it has one, and
// else its glob, bare.
const writeMatcher = (
  value: unknown,
  path: string,
  source: Source,
): unknown => {
  const fields = Fields.of(value, path, source);
  const glob = fields.string('glob', '');
  const any = fields.strings('any');
  fields.done();
  if (glob !== '' && any.length > 0) {
    throw new PolicyFileError(
      path,
      'a matcher that sets both `glob` and `any` cannot be written to a policy file, which has one or the other',
    );
  }
  return any.length > 0 ? { any } : glob;
};

// The params of a rule as nested mappings, which is how a file writes them on
// an MCP endpoint. Undefined when two keys cannot both be nested, one being
// the start of the other; they are then written flat.
const nestParams = (flat: [string, unknown][]): Doc | undefined => {
  const leaves = new Set<unknown>();
  const root: Doc = {};
  for (const [key, matcher] of flat) {
    const parts = key.split('.');
    let level = root;
    for (const part of parts.slice(0, -1)) {
      if (!has(level, part)) {
        Object.defineProperty(level, part, {
          value: {},
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      const child = level[part];
      if (leaves.has(child) || !isMapping(child)) {
        return undefined;
      }
      level = child;
    }
    // A matcher that is a list is a mapping too, and is not a level.
    leaves.add(matcher);
    Object.defineProperty(level, parts[parts.length - 1], {
      value: matcher,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return root;
};

// An allow or deny rule of the API as a file writes it.
const writeMatch = (
  value: unknown,
  path: string,
  source: Source,
  protocol: string,
  allowsAllKnownMethods: boolean,
): Doc => {
  const fields = Fields.of(value, path, source);
  const isMcp = isMcpProtocol(protocol);
  const matchers = (key: string): [string, unknown][] =>
    fields.entries(key, (matcher, matcherPath) =>
      writeMatcher(matcher, matcherPath, source),
    );
  let params = matchers('params');
  // Only MCP has a tool, and only there are params nested.
  const tool = isMcp ? params.find(([name]) => name === 'name') : undefined;
  if (tool) {
    params = params.filter((entry) => entry !== tool);
  }
  let method = fields.string('method', '');
  if (
    isMcp &&
    ((!tool && method === '*') ||
      (tool && method === 'tools/call' && allowsAllKnownMethods))
  ) {
    method = '';
  }

  const doc: Doc = {};
  put(doc, 'method', method);
  put(doc, 'path', fields.string('path', ''));
  put(doc, 'command', fields.string('command', ''));
  put(doc, 'query', Object.fromEntries(matchers('query')));
  put(doc, 'operation_type', fields.string('operationType', ''));
  put(doc, 'operation_name', fields.string('operationName', ''));
  put(doc, 'fields', fields.strings('fields'));
  if (tool) {
    doc.tool = tool[1];
  }
  const nested = isMcp ? nestParams(params) : undefined;
  put(doc, 'params', nested ? sortKeys(nested) : Object.fromEntries(params));
  fields.done();
  return doc;
};

// What upstream finds wrong with the MCP options of one endpoint before it
// will write a policy: every thing, as it words them.
const mcpViolations = (
  ruleName: string,
  host: string,
  protocol: string,
  hasOptions: boolean,
  versions: string[],
): string[] => {
  if (!isMcpProtocol(protocol)) {
    return hasOptions
      ? [
          `network policy '${ruleName}': endpoint '${host}' uses protocol '${protocol}' and cannot configure mcp options`,
        ]
      : [];
  }
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const version of versions) {
    if (seen.has(version)) {
      violations.push(
        `network policy '${ruleName}': MCP endpoint '${host}' repeats protocol version '${version}'`,
      );
    }
    seen.add(version);
    if (!MCP_VERSIONS.includes(version)) {
      violations.push(
        `network policy '${ruleName}': MCP endpoint '${host}' has unsupported protocol version '${version}'; ${MCP_VERSION_REMEDIATION}`,
      );
    }
  }
  return violations;
};

// What is found on the way through a policy that keeps it from being written
// as a file.
type WriteProblems = {
  modes: PolicyFileDiagnostic[];
  mcp: PolicyFileDiagnostic[];
};

// The file's name for a mode the API returned, or undefined, with the reason
// noted, when it has none.
const writeMode = (
  fields: Fields,
  key: string,
  mode: EndpointMode,
  context: string,
  problems: WriteProblems,
): string => {
  const value = fields.raw(key);
  if (value === undefined) {
    return '';
  }
  const number =
    typeof value === 'string' || typeof value === 'number'
      ? modeNumber(mode, value)
      : undefined;
  if (number === undefined) {
    problems.modes.push({
      path: fields.at(key),
      message: `${context}: unknown ${key} enum value ${
        typeof value === 'string' || typeof value === 'number'
          ? value
          : describe(value)
      }`,
    });
    return '';
  }
  const name = mode.file[number];
  if (mode === TLS_MODE && !isSupportedTls(name)) {
    problems.modes.push({
      path: fields.at(key),
      message: `${context}: ${unknownTls(name)}`,
    });
    return '';
  }
  return name;
};

const writeEndpoint = (
  value: unknown,
  path: string,
  index: number,
  rule: RuleContext,
  source: Source,
  problems: WriteProblems,
): Doc => {
  const fields = Fields.of(value, path, source);
  const host = fields.string('host', '');
  const protocol = fields.string('protocol', '');
  const isMcp = isMcpProtocol(protocol);
  const context = `network policy '${rule.key}': endpoint ${index}`;

  const mcp = fields.optional('mcp', (options) => {
    const read = {
      strictToolNames: options.optionalBoolean('strictToolNames'),
      allowAllKnownMcpMethods: options.optionalBoolean(
        'allowAllKnownMcpMethods',
      ),
      versions: options.strings('versions'),
    };
    options.done();
    return read;
  });
  problems.mcp.push(
    ...mcpViolations(
      rule.name,
      host,
      protocol,
      mcp !== undefined,
      mcp?.versions ?? [],
    ).map((message) => ({ path: fields.at('mcp'), message })),
  );
  const allowsAllKnownMethods =
    !isMcp || (mcp?.allowAllKnownMcpMethods ?? false);

  // One port is written as `port` and several as `ports`. A file's ports are
  // 16 bits wide and the API's 32, so a port that does not fit is refused.
  const checked = (port: number): number => {
    if (port > U16_MAX) {
      throw new PolicyFileError(
        path,
        `cannot serialize endpoint '${host}': port ${port} exceeds ${U16_MAX}`,
      );
    }
    return port;
  };
  const port = fields.optionalInteger('port', 0, U32_MAX, 'a port number') ?? 0;
  const ports = fields.list('ports', (entry, entryPath) =>
    integerIn(entry, entryPath, 0, U32_MAX, 'a port number'),
  );

  const doc: Doc = {};
  put(doc, 'host', host);
  put(doc, 'path', fields.string('path', ''));
  if (ports.length > 1) {
    doc.ports = ports.map(checked);
  } else {
    put(doc, 'port', checked(ports[0] ?? port));
  }
  put(doc, 'protocol', protocol);
  put(doc, 'tls', writeMode(fields, 'tls', TLS_MODE, context, problems));
  put(
    doc,
    'enforcement',
    writeMode(fields, 'enforcement', ENFORCEMENT_MODE, context, problems),
  );
  put(
    doc,
    'access',
    writeMode(fields, 'access', ACCESS_PRESET, context, problems),
  );
  put(
    doc,
    'rules',
    fields.list('rules', (entry, rulePath) => {
      const allow = Fields.of(entry, rulePath, source);
      // A rule that allows nothing in particular is still written with its
      // `allow`, which a file's rule has to have.
      const written = {
        allow: writeMatch(
          allow.raw('allow') ?? {},
          join(rulePath, 'allow'),
          source,
          protocol,
          allowsAllKnownMethods,
        ),
      };
      allow.done();
      return written;
    }),
  );
  put(doc, 'allowed_ips', fields.strings('allowedIps'));
  put(
    doc,
    'deny_rules',
    fields.list('denyRules', (entry, rulePath) =>
      writeMatch(entry, rulePath, source, protocol, allowsAllKnownMethods),
    ),
  );
  put(doc, 'allow_encoded_slash', fields.boolean('allowEncodedSlash'));
  put(
    doc,
    'websocket_credential_rewrite',
    fields.boolean('websocketCredentialRewrite'),
  );
  put(
    doc,
    'request_body_credential_rewrite',
    fields.boolean('requestBodyCredentialRewrite'),
  );
  put(
    doc,
    'allow_uninspected_credentials',
    fields.boolean('allowUninspectedCredentials'),
  );
  put(doc, 'persisted_queries', fields.string('persistedQueries', ''));
  put(
    doc,
    'graphql_persisted_queries',
    Object.fromEntries(
      fields.entries('graphqlPersistedQueries', (entry, entryPath) => {
        const operation = Fields.of(entry, entryPath, source);
        const written: Doc = {};
        put(written, 'operation_type', operation.string('operationType', ''));
        put(written, 'operation_name', operation.string('operationName', ''));
        put(written, 'fields', operation.strings('fields'));
        operation.done();
        return written;
      }),
    ),
  );
  put(
    doc,
    'graphql_max_body_bytes',
    fields.optionalInteger('graphqlMaxBodyBytes', 0, U32_MAX, BYTES) ?? 0,
  );
  put(doc, 'credential_signing', fields.string('credentialSigning', ''));
  put(doc, 'signing_service', fields.string('signingService', ''));
  put(doc, 'signing_region', fields.string('signingRegion', ''));
  const binding = fields.optional('credentialBinding', (entry) => {
    const written = { provider: entry.string('provider', '') };
    entry.done();
    return written;
  });
  if (binding) {
    doc.credential_binding = binding;
  }
  // The API's one body limit is the MCP mapping's on an MCP endpoint and the
  // JSON-RPC mapping's on any other.
  const maxBodyBytes =
    fields.optionalInteger('jsonRpcMaxBodyBytes', 0, U32_MAX, BYTES) ?? 0;
  if (isMcp) {
    // An MCP endpoint that lists no revisions accepts the default one, and a
    // file says so.
    const versions = mcp?.versions.length
      ? mcp.versions
      : [DEFAULT_MCP_VERSION];
    const stanza: Doc = { versions: canonicalMcpVersions(versions) };
    put(stanza, 'max_body_bytes', maxBodyBytes);
    // Written whenever set, false included: unset is not false here.
    if (mcp?.strictToolNames !== undefined) {
      stanza.strict_tool_names = mcp.strictToolNames;
    }
    if (mcp?.allowAllKnownMcpMethods !== undefined) {
      stanza.allow_all_known_mcp_methods = mcp.allowAllKnownMcpMethods;
    }
    doc.mcp = stanza;
  } else if (maxBodyBytes > 0) {
    doc.json_rpc = { max_body_bytes: maxBodyBytes };
  }
  // The gateway's own marks, which a file has no field for.
  fields.optionalBoolean('providerCredentialed');
  fields.optionalBoolean('advisorProposed');
  fields.done();
  return doc;
};

// A value of a middleware's config with its keys in order, which is how
// upstream writes any JSON.
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isMapping(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
};

const writeMiddleware = (value: unknown, path: string, source: Source): Doc => {
  const fields = Fields.of(value, path, source);
  const doc: Doc = {};
  put(doc, 'name', fields.string('name', ''));
  doc.middleware = fields.string('middleware', '');
  put(
    doc,
    'order',
    fields.optionalInteger('order', I32_MIN, I32_MAX, 'a whole number') ?? 0,
  );
  put(
    doc,
    'config',
    Object.fromEntries(fields.entries('config', (entry) => sortKeys(entry))),
  );
  put(doc, 'on_error', fields.string('onError', ''));
  const endpoints = fields.optional('endpoints', (selector) => {
    const written: Doc = {};
    put(written, 'include', selector.strings('include'));
    put(written, 'exclude', selector.strings('exclude'));
    selector.done();
    return written;
  });
  if (endpoints) {
    doc.endpoints = endpoints;
  }
  fields.done();
  return doc;
};

// policyToDocument converts a policy to the document a policy file holds:
// what upstream's serializers make of it, with the fields in the order it
// writes them and the same ones left out when they hold nothing. A policy
// that holds something a file cannot say yields no document and what it was.
//
// A policy the gateway returned names only fields this knows. One that a
// person typed may not, and a field it does not know is reported, because the
// file would otherwise leave it out without a word.
export const policyToDocument = (
  policy: unknown,
): { document?: Doc; diagnostics: PolicyFileDiagnostic[] } => {
  const source: Source = { nullIsUnset: true, unknown: [] };
  const problems: WriteProblems = { modes: [], mcp: [] };
  try {
    if (isTooDeep(policy)) {
      throw new PolicyFileError('', TOO_DEEP);
    }
    const root = Fields.of(policy, '', source);
    // A version that was never set is the one there is.
    const version =
      root.optionalInteger('version', 0, U32_MAX, 'a whole number') ?? 0;
    if (version > 1) {
      return {
        diagnostics: [
          {
            path: 'version',
            message: `cannot serialize unsupported protobuf policy version ${version}; expected 0 (omitted) or 1`,
          },
        ],
      };
    }
    const doc: Doc = { version: 1 };
    const filesystem = root.optional('filesystem', (fields) => {
      const written: Doc = {
        include_workdir: fields.boolean('includeWorkdir'),
      };
      put(written, 'read_only', fields.strings('readOnly'));
      put(written, 'read_write', fields.strings('readWrite'));
      fields.done();
      return written;
    });
    if (filesystem) {
      doc.filesystem_policy = filesystem;
    }
    const landlock = root.optional('landlock', (fields) => {
      // No mode is the default one.
      const compatibility = fields.string('compatibility', '') || 'best_effort';
      if (!LANDLOCK_COMPATIBILITY.includes(compatibility)) {
        throw new PolicyFileError(
          fields.at('compatibility'),
          `invalid landlock.compatibility ${JSON.stringify(compatibility)}; accepted: ${LANDLOCK_COMPATIBILITY.join(', ')}`,
        );
      }
      fields.done();
      return { compatibility };
    });
    if (landlock) {
      doc.landlock = landlock;
    }
    // A process section that names neither identity says nothing, and is
    // left out.
    const process = root.optional('process', (fields) => {
      const written: Doc = {};
      put(written, 'run_as_user', fields.string('runAsUser', ''));
      put(written, 'run_as_group', fields.string('runAsGroup', ''));
      fields.done();
      return written;
    });
    if (process && Object.keys(process).length > 0) {
      doc.process = process;
    }
    put(
      doc,
      'network_policies',
      Object.fromEntries(
        root.entries('networkPolicies', (value, path, key) => {
          const fields = Fields.of(value, path, source);
          const name = fields.string('name', '');
          const rule: Doc = {};
          put(rule, 'name', name);
          put(
            rule,
            'endpoints',
            fields.list('endpoints', (endpoint, endpointPath, index) =>
              writeEndpoint(
                endpoint,
                endpointPath,
                index,
                { key, name: name || key },
                source,
                problems,
              ),
            ),
          );
          put(
            rule,
            'binaries',
            fields.list('binaries', (binary, binaryPath) => {
              const entry = Fields.of(binary, binaryPath, source);
              const written = { path: entry.string('path', '') };
              entry.done();
              return written;
            }),
          );
          fields.done();
          return rule;
        }),
      ),
    );
    put(
      doc,
      'network_middlewares',
      Object.fromEntries(
        root.entries('networkMiddlewares', (value, path) =>
          writeMiddleware(value, path, source),
        ),
      ),
    );
    root.done();

    const unknown = source.unknown ?? [];
    if (unknown.length > 0) {
      return {
        diagnostics: unknownFieldDiagnostics(
          unknown,
          (path) =>
            `unknown field '${path}': it is not a field of a policy, and a policy file has no place for it`,
        ),
      };
    }
    // In upstream's order: the modes of every endpoint, then its MCP options.
    if (problems.modes.length > 0) {
      return { diagnostics: problems.modes };
    }
    if (problems.mcp.length > 0) {
      return {
        diagnostics: [
          {
            path: problems.mcp[0].path,
            message: `cannot serialize invalid sandbox policy: sandbox policy validation failed; ${problems.mcp
              .map((problem) => problem.message)
              .join('; ')}`,
          },
        ],
      };
    }
    return { document: doc, diagnostics: [] };
  } catch (error) {
    // As for reading: whatever the policy is, a diagnostic and no exception.
    const path = error instanceof PolicyFileError ? error.path : '';
    return {
      diagnostics: [
        {
          path,
          message: path ? `${path}: ${reasonOf(error)}` : reasonOf(error),
        },
      ],
    };
  }
};

// serializePolicyFile writes a policy as a policy file: the YAML `openshell
// policy get --full` prints for it, or the JSON form of the same document
// that `-o json` prints, which has its keys in order as upstream's has.
export const serializePolicyFile = (
  policy: SandboxPolicy,
  format: PolicyFileFormat,
): SerializedPolicy => {
  const { document, diagnostics } = policyToDocument(policy);
  if (!document) {
    return { diagnostics };
  }
  try {
    if (format === 'json') {
      return {
        text: `${JSON.stringify(sortKeys(document), null, 2)}\n`,
        diagnostics,
      };
    }
    // No line folding: a folded path glob is still valid YAML and much harder
    // to read and to diff.
    return { text: stringify(document, { lineWidth: 0 }), diagnostics };
  } catch (error) {
    return { diagnostics: [{ path: '', message: reasonOf(error) }] };
  }
};

// --- Policy text ---
//
// What a person pastes, loads or edits in the dashboard is one of three
// things: a policy file in YAML, a policy file in JSON, or the policy as the
// API holds it, in JSON, which is what the dashboard showed before it knew
// about policy files and still shows as its JSON. The two that follow tell
// them apart and turn any of them into a policy.

// What reading a text gives: a policy or the reasons there is none, and the
// syntax the text is in, which is what an editor highlights it as.
export type PolicyText = ParsedPolicyFile & {
  format: PolicyFileFormat;
};

// The syntax a text is written in, by how it starts. A text being typed is
// rarely valid, and this does not change with every key.
export const policyTextFormat = (text: string): PolicyFileFormat =>
  /^\s*\{/.test(text) ? 'json' : 'yaml';

// The fields that are spelt one way in a policy file and another in the API.
// A JSON document is taken for whichever it uses.
const FILE_ONLY_FIELDS = [
  'filesystem_policy',
  'network_policies',
  'network_middlewares',
];
const API_ONLY_FIELDS = ['filesystem', 'networkPolicies', 'networkMiddlewares'];

// Whether a JSON document is a policy file or the API's policy. One that uses
// no field the two spell differently is the API's unless its process section
// is a file's; the two are then read to the same policy.
const jsonDocumentKind = (document: Doc): 'file' | 'api' | 'mixed' => {
  const file = FILE_ONLY_FIELDS.some((key) => has(document, key));
  const api = API_ONLY_FIELDS.some((key) => has(document, key));
  if (file && api) {
    return 'mixed';
  }
  if (file || api) {
    return file ? 'file' : 'api';
  }
  const process = document.process;
  return isMapping(process) &&
    (has(process, 'run_as_user') || has(process, 'run_as_group'))
    ? 'file'
    : 'api';
};

// readPolicyText reads whatever text a policy was given as: YAML or JSON, a
// policy file or the API's own JSON. The policy it returns is ready to send.
//
// The API's JSON is returned as it was written, as it always has been: the
// gateway's schema is the judge of it, and its message is shown as it is.
export const readPolicyText = (text: string): PolicyText => {
  const format = policyTextFormat(text);
  if (format === 'yaml') {
    return { format, ...parsePolicyFile(text) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // A YAML mapping may be written in braces too.
    try {
      return { format, ...policyFromDocument(loadPolicyDocument(text)) };
    } catch {
      return {
        format,
        diagnostics: [
          { path: '', message: `Invalid JSON: ${(error as Error).message}` },
        ],
      };
    }
  }
  if (!isMapping(parsed)) {
    return {
      format,
      diagnostics: [{ path: '', message: 'expected a JSON object' }],
    };
  }
  const kind = jsonDocumentKind(parsed);
  if (kind === 'api') {
    return { format, policy: parsed as SandboxPolicy, diagnostics: [] };
  }
  if (kind === 'mixed') {
    return {
      format,
      diagnostics: [
        {
          path: '',
          message: `the document mixes the fields of a policy file (${FILE_ONLY_FIELDS.filter(
            (key) => has(parsed as Doc, key),
          ).join(
            ', ',
          )}) with the fields of the gateway's JSON (${API_ONLY_FIELDS.filter(
            (key) => has(parsed as Doc, key),
          ).join(', ')}); use one or the other`,
        },
      ],
    };
  }
  // Read again as upstream reads it, for what JSON.parse lets through: a key
  // written twice, and a whole number too large to keep exact.
  try {
    return { format, ...policyFromDocument(loadPolicyDocument(text)) };
  } catch (error) {
    if (error instanceof PolicySyntaxError && error.kind === 'syntax') {
      return { format, ...policyFromDocument(parsed) };
    }
    return { format, ...syntaxDiagnostic(error) };
  }
};

// policyToText writes a policy as the text the dashboard shows it as: `yaml`
// is the policy file, and `json` is the policy as the API holds it.
export const policyToText = (
  policy: SandboxPolicy,
  format: PolicyFileFormat,
): SerializedPolicy => {
  if (format === 'yaml') {
    return serializePolicyFile(policy, 'yaml');
  }
  try {
    const text = JSON.stringify(policy, null, 2) as string | undefined;
    return text === undefined
      ? { diagnostics: [{ path: '', message: 'there is no policy to show' }] }
      : { text, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [{ path: '', message: reasonOf(error) }] };
  }
};

// Whether a policy carries a mark only the gateway sets on an endpoint. A
// policy file has no field for those, so the YAML of such a policy is written
// without them and says a little less than its JSON.
export const hasGatewayMarks = (policy: SandboxPolicy): boolean => {
  const rules: unknown = policy?.networkPolicies;
  return (
    isMapping(rules) &&
    Object.values(rules).some(
      (rule) =>
        isMapping(rule) &&
        sequence(rule.endpoints).some(
          (endpoint) =>
            isMapping(endpoint) &&
            Boolean(endpoint.providerCredentialed || endpoint.advisorProposed),
        ),
    )
  );
};
