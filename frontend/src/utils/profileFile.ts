import {
  isScalar,
  LineCounter,
  parseDocument,
  Scalar,
  stringify,
  visit,
} from 'yaml';

import type {
  ImportProfileRequest,
  L7QueryMatcher,
  ProfileBinary,
  ProfileCredential,
  ProfileCredentialRefresh,
  ProfileDiagnostic,
  ProfileFile,
  ProfileGraphqlOperation,
  ProfileL7Match,
  ProfileMcpOptions,
  ProfileNetworkEndpoint,
  ProfileRefreshMaterial,
  ProfileRefreshOutput,
  ProfileTokenGrant,
  ProfileTokenGrantAudienceOverride,
  ProviderProfile,
  ProviderProfileCategory,
} from '../types';

// Provider profile files: the YAML and JSON documents `openshell provider
// profile export` writes and `import`, `update` and `lint` read. This module
// is the one place that knows both that file schema and the profile the BFF
// takes and returns, and maps one to the other.
//
// The schema is upstream's, read from the serde definition of
// ProviderTypeProfile in crates/openshell-providers/src/profiles.rs at v0.1.2,
// with `files`, the one field v0.1.3 added to it: the field names, which
// fields may be left out and what they default to, and the fields that are not
// plain data. Those are ported here by hand:
//
//   - category, refresh strategy and token grant type are names matched
//     without regard to case, with "-" read as "_".
//   - A duration is a protobuf duration string ("300s"). The `_seconds` field
//     beside each one is the older spelling, a whole number of seconds; it is
//     still read, the string wins when a file has both, and only the string is
//     written. An absent duration and "0s" are different things.
//   - tls, access and enforcement are names the API carries as enum values. A
//     name upstream does not know is sent as the number -1, as the CLI sends
//     it, so that the gateway reports it; it is not corrected here.
//   - A matcher may be a bare string, which is its glob.
//   - A binary may be a bare string, which is its path.
//   - An MCP rule's `tool` is its `params.name`.
//   - `rules: []` and `deny_rules: []` mean something a missing list does not
//     (deny everything; nothing), and the API cannot tell the two apart, so an
//     empty list is refused here, before it is sent, as the CLI refuses it.
//
// What is left to the gateway is everything it can see for itself once the
// profile reaches it: whether ids are well formed, endpoints valid, credentials
// consistent. That includes which MCP protocol revisions are supported and
// which one an endpoint gets when it names none. The CLI fills that default in
// before it sends; here the endpoint is sent as written and the gateway fills
// in its own.
//
// A file does not carry what the gateway works out for itself and upstream's
// file has no field for: since v0.1.3, the `token_grant_owners` of a
// credential and the `token_grant_owner` of an endpoint. The gateway ignores
// what a profile is written with for both, so a profile that is exported and
// imported again loses nothing the gateway would have kept.
//
// Unlike upstream, a field the schema does not have is reported, as a warning:
// serde skips unknown fields silently, and a misspelt `enforcment` is a profile
// that says less than its author thinks.
//
// A YAML merge key (`<<: *anchor`) is refused. It is not applied here, and
// whether upstream's reader applies one to a profile file is not something
// this port could establish, so a file that uses one is not read at all:
// read without it, an entry would be imported with fewer fields than the file
// appears to give it.

export type ProfileFileFormat = 'yaml' | 'json';

// What reading a profile file yields: the profile to send, unless the file
// could not be read as one, and what was found on the way. A diagnostic has
// the shape of the gateway's own, so both are shown the same way.
export type ParsedProfileFile = {
  profile?: ImportProfileRequest;
  diagnostics: ProfileDiagnostic[];
};

// The format a profile file is read as, by its extension: .yaml, .yml or
// .json. Any other file is not a profile file.
export const profileFileFormat = (
  fileName: string,
): ProfileFileFormat | undefined => {
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1];
  if (extension === 'yaml' || extension === 'yml') {
    return 'yaml';
  }
  return extension === 'json' ? 'json' : undefined;
};

// --- Enum spellings ---

const CATEGORY_FROM_FILE: Record<string, ProviderProfileCategory> = {
  '': 'OTHER',
  other: 'OTHER',
  inference: 'INFERENCE',
  agent: 'AGENT',
  source_control: 'SOURCE_CONTROL',
  messaging: 'MESSAGING',
  data: 'DATA',
  knowledge: 'KNOWLEDGE',
};

const CATEGORY_TO_FILE: Record<string, string> = {
  INFERENCE: 'inference',
  AGENT: 'agent',
  SOURCE_CONTROL: 'source_control',
  MESSAGING: 'messaging',
  DATA: 'data',
  KNOWLEDGE: 'knowledge',
};

const STRATEGY_FROM_FILE: Record<string, string> = {
  '': 'UNSPECIFIED',
  static: 'STATIC',
  external: 'EXTERNAL',
  oauth2_refresh_token: 'OAUTH2_REFRESH_TOKEN',
  oauth2_client_credentials: 'OAUTH2_CLIENT_CREDENTIALS',
  google_service_account_jwt: 'GOOGLE_SERVICE_ACCOUNT_JWT',
  aws_sts_assume_role: 'AWS_STS_ASSUME_ROLE',
};

const STRATEGY_TO_FILE: Record<string, string> = {
  STATIC: 'static',
  EXTERNAL: 'external',
  OAUTH2_REFRESH_TOKEN: 'oauth2_refresh_token',
  OAUTH2_CLIENT_CREDENTIALS: 'oauth2_client_credentials',
  GOOGLE_SERVICE_ACCOUNT_JWT: 'google_service_account_jwt',
  AWS_STS_ASSUME_ROLE: 'aws_sts_assume_role',
};

const GRANT_TYPE_FROM_FILE: Record<string, string> = {
  '': 'CLIENT_CREDENTIALS',
  client_credentials: 'CLIENT_CREDENTIALS',
  token_exchange: 'TOKEN_EXCHANGE',
};

const TLS_MODES: Record<string, string> = {
  skip: 'NETWORK_TLS_MODE_SKIP',
  terminate: 'NETWORK_TLS_MODE_TERMINATE',
  passthrough: 'NETWORK_TLS_MODE_PASSTHROUGH',
};

const ENFORCEMENT_MODES: Record<string, string> = {
  enforce: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
  audit: 'NETWORK_ENFORCEMENT_MODE_AUDIT',
};

const ACCESS_PRESETS: Record<string, string> = {
  'read-only': 'NETWORK_ACCESS_PRESET_READ_ONLY',
  'read-write': 'NETWORK_ACCESS_PRESET_READ_WRITE',
  full: 'NETWORK_ACCESS_PRESET_FULL',
};

// The enum value of an endpoint mode written as a name. No name is the
// unspecified value, which the API carries by leaving the field out, and a name
// upstream does not know is -1 for the gateway to refuse.
const modeFromFile = (
  names: Record<string, string>,
  name: string,
): string | number | undefined => {
  if (name === '') {
    return undefined;
  }
  return names[name] ?? -1;
};

// The name of an endpoint mode the API returned. Upstream writes a value it
// has no name for as "unknown(N)".
const modeToFile = (
  names: Record<string, string>,
  unspecified: string,
  value: string | number | undefined,
): string => {
  if (value === undefined || value === unspecified || value === 0) {
    return '';
  }
  const name = Object.keys(names).find((key) => names[key] === value);
  return name ?? `unknown(${value})`;
};

// How upstream reads an enum name: case and surrounding space do not matter,
// and "-" is "_".
const enumKey = (raw: string): string =>
  raw.trim().toLowerCase().replace(/-/g, '_');

// The names a profile file writes for a category, a refresh strategy and an
// access preset. They are also what the OpenShell CLI and TUI print, so the
// pages that describe a provider's profile use them as well.

// A category without a name of its own is "other".
export const profileCategoryName = (category: string): string =>
  CATEGORY_TO_FILE[category] ?? 'other';

export const refreshStrategyName = (strategy: string): string =>
  STRATEGY_TO_FILE[strategy] ?? 'unspecified';

// Empty for an endpoint that names no preset.
export const accessPresetName = (access: string | number | undefined): string =>
  modeToFile(ACCESS_PRESETS, 'NETWORK_ACCESS_PRESET_UNSPECIFIED', access);

// --- Reading a file ---

// What a profile file got wrong, and where: `path` is the field, in the
// file's own spelling.
class ProfileFileError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type Doc = Record<string, unknown>;

const describe = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'a list';
  }
  return typeof value === 'object'
    ? 'a mapping'
    : `${typeof value} \`${value}\``;
};

const join = (path: string, key: string): string =>
  path ? `${path}.${key}` : key;

// One mapping of the file, read field by field. It notes which keys were
// asked for, so that the ones nothing asked for can be reported.
class Mapping {
  private readonly read = new Set<string>();

  constructor(
    private readonly doc: Doc,
    readonly path: string,
    private readonly unknown: string[],
  ) {}

  static of(value: unknown, path: string, unknown: string[]): Mapping {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProfileFileError(
        path,
        `invalid type: ${describe(value)}, expected a mapping`,
      );
    }
    return new Mapping(value as Doc, path, unknown);
  }

  private take(key: string): unknown {
    this.read.add(key);
    return this.doc[key];
  }

  // Whether the mapping has the field: a key of its own, and not something
  // every object inherits.
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.doc, key);
  }

  at(key: string): string {
    return join(this.path, key);
  }

  fail(key: string, message: string): never {
    throw new ProfileFileError(this.at(key), message);
  }

  private typed<T>(
    key: string,
    expected: string,
    check: (value: unknown) => value is T,
    fallback: T | undefined,
  ): T {
    if (!this.has(key)) {
      if (fallback === undefined) {
        throw new ProfileFileError(this.path, `missing field \`${key}\``);
      }
      this.read.add(key);
      return fallback;
    }
    const value = this.take(key);
    if (!check(value)) {
      this.fail(key, `invalid type: ${describe(value)}, expected ${expected}`);
    }
    return value;
  }

  // A string. Without a fallback the field is required.
  string(key: string, fallback?: string): string {
    return this.typed(
      key,
      'a string',
      (value): value is string => typeof value === 'string',
      fallback,
    );
  }

  boolean(key: string): boolean {
    return this.typed(
      key,
      'a boolean',
      (value): value is boolean => typeof value === 'boolean',
      false,
    );
  }

  // A whole number from 0 up to `max`.
  unsigned(key: string, max: number, what: string): number {
    return this.typed(
      key,
      what,
      (value): value is number =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= max,
      0,
    );
  }

  integer(key: string): number {
    return this.typed(
      key,
      'a whole number',
      (value): value is number =>
        typeof value === 'number' && Number.isInteger(value),
      0,
    );
  }

  // A list, each element converted by `each`. A missing list is empty.
  list<T>(key: string, each: (value: unknown, path: string) => T): T[] {
    if (!this.has(key)) {
      this.read.add(key);
      return [];
    }
    const value = this.take(key);
    if (!Array.isArray(value)) {
      this.fail(key, `invalid type: ${describe(value)}, expected a list`);
    }
    return value.map((element, index) =>
      each(element, `${this.at(key)}[${index}]`),
    );
  }

  strings(key: string): string[] {
    return this.list(key, (value, path) => {
      if (typeof value !== 'string') {
        throw new ProfileFileError(
          path,
          `invalid type: ${describe(value)}, expected a string`,
        );
      }
      return value;
    });
  }

  // A mapping from name to a value converted by `each`. A missing one is empty.
  map<T>(
    key: string,
    each: (value: unknown, path: string) => T,
  ): Record<string, T> {
    if (!this.has(key)) {
      this.read.add(key);
      return {};
    }
    const entries = Mapping.of(this.take(key), this.at(key), this.unknown);
    // The names are the author's, and any text is a name: "__proto__" too.
    // Object.fromEntries makes each one an entry of its own, where assigning
    // it to a plain object would set the object's prototype and lose it.
    return Object.fromEntries(
      Object.keys(entries.doc).map((name): [string, T] => [
        name,
        each(entries.take(name), join(entries.path, name)),
      ]),
    );
  }

  // A nested mapping, or undefined when the field is missing or null.
  optional<T>(key: string, convert: (mapping: Mapping) => T): T | undefined {
    const value = this.take(key);
    if (value === undefined || value === null) {
      return undefined;
    }
    return convert(Mapping.of(value, this.at(key), this.unknown));
  }

  raw(key: string): unknown {
    return this.take(key);
  }

  // Reports the keys nothing read, and returns them.
  done(): string[] {
    const extra = Object.keys(this.doc).filter((key) => !this.read.has(key));
    this.unknown.push(...extra.map((key) => this.at(key)));
    return extra;
  }
}

const U32_MAX = 0xffffffff;

// A protobuf duration as text: seconds, with up to nine decimal places, and
// "s". The gateway judges whether the value itself is acceptable.
const DURATION = /^-?\d+(\.\d{1,9})?s$/;

// The duration a profile sets through its string field and its older
// whole-seconds field. The string wins; a zero number of seconds means the
// field was not set; neither set is no duration.
const readDuration = (mapping: Mapping, field: string): string | undefined => {
  const legacy = mapping.integer(`${field}_seconds`);
  if (mapping.has(field)) {
    const text = mapping.string(field);
    if (!DURATION.test(text)) {
      mapping.fail(
        field,
        `invalid duration "${text}": expected seconds such as "300s"`,
      );
    }
    return text;
  }
  return legacy !== 0 ? `${legacy}s` : undefined;
};

const readMatcher = (
  value: unknown,
  path: string,
  unknown: string[],
): L7QueryMatcher => {
  if (typeof value === 'string') {
    return { glob: value };
  }
  const mapping = Mapping.of(value, path, unknown);
  const matcher = compact<L7QueryMatcher>({
    glob: mapping.string('glob', ''),
    any: mapping.strings('any'),
  });
  mapping.done();
  return matcher;
};

// Drops the fields of an object that hold nothing: empty text, empty lists
// and maps, false, zero and undefined. That is how the API carries a field
// that is not set, and it keeps what is sent to what the file says.
const compact = <T extends object>(value: Record<string, unknown>): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => {
      const empty =
        field === undefined ||
        field === '' ||
        field === false ||
        field === 0 ||
        (Array.isArray(field) && field.length === 0) ||
        (typeof field === 'object' &&
          field !== null &&
          !Array.isArray(field) &&
          Object.keys(field).length === 0);
      return !empty;
    }),
  ) as T;

// An allow or deny rule. `tool` is shorthand for the `name` entry of `params`
// and does not replace one that is already there; on an MCP endpoint a rule
// that sets both is ambiguous and refused.
const readMatch = (
  mapping: Mapping,
  unknown: string[],
  isMcp: boolean,
): ProfileL7Match => {
  const matcher = (value: unknown, path: string) =>
    readMatcher(value, path, unknown);
  const params = mapping.map('params', matcher);
  const tool = mapping.raw('tool');
  if (tool !== undefined && tool !== null) {
    if (isMcp && 'name' in params) {
      throw new ProfileFileError(
        mapping.path,
        'MCP rules must use either tool or params.name, not both',
      );
    }
    params.name ??= matcher(tool, mapping.at('tool'));
  }
  const match = compact<ProfileL7Match>({
    method: mapping.string('method', ''),
    path: mapping.string('path', ''),
    command: mapping.string('command', ''),
    query: mapping.map('query', matcher),
    operationType: mapping.string('operation_type', ''),
    operationName: mapping.string('operation_name', ''),
    fields: mapping.strings('fields'),
    params,
  });
  mapping.done();
  return match;
};

const readMcp = (mapping: Mapping): ProfileMcpOptions => {
  const options: ProfileMcpOptions = {};
  if (mapping.has('versions')) {
    const versions = mapping.strings('versions');
    if (versions.length === 0) {
      mapping.fail(
        'versions',
        'mcp.versions must contain at least one supported protocol version',
      );
    }
    const repeated = versions.find(
      (version, index) => versions.indexOf(version) !== index,
    );
    if (repeated !== undefined) {
      mapping.fail('versions', `duplicate MCP protocol version '${repeated}'`);
    }
    options.versions = versions;
  }
  for (const [key, field] of [
    ['strict_tool_names', 'strictToolNames'],
    ['allow_all_known_mcp_methods', 'allowAllKnownMcpMethods'],
  ] as const) {
    // Unset and false are different here: unset takes the gateway's default.
    if (mapping.has(key) && mapping.raw(key) !== null) {
      options[field] = mapping.boolean(key);
    }
  }
  // Upstream refuses an unknown field in this one mapping.
  const extra = mapping.done();
  if (extra.length > 0) {
    throw new ProfileFileError(
      mapping.path,
      `unknown field \`${extra[0]}\`, expected one of \`versions\`, \`strict_tool_names\`, \`allow_all_known_mcp_methods\``,
    );
  }
  return options;
};

// A rule list. Missing is no list; empty is an error, because the API cannot
// say "an empty list" and the two mean different things.
const readRules = <T>(
  mapping: Mapping,
  key: string,
  emptyMessage: string,
  each: (value: unknown, path: string) => T,
): T[] | undefined => {
  if (!mapping.has(key) || mapping.raw(key) === null) {
    mapping.raw(key);
    return undefined;
  }
  const rules = mapping.list(key, each);
  if (rules.length === 0) {
    throw new ProfileFileError(mapping.path, emptyMessage);
  }
  return rules;
};

const readEndpoint = (
  value: unknown,
  path: string,
  unknown: string[],
): ProfileNetworkEndpoint => {
  const mapping = Mapping.of(value, path, unknown);
  const protocol = mapping.string('protocol', '');
  const isMcp = protocol.trim().toLowerCase() === 'mcp';
  const match = (rule: unknown, rulePath: string) =>
    readMatch(Mapping.of(rule, rulePath, unknown), unknown, isMcp);

  if (mapping.has('mcp') && mapping.raw('mcp') === null) {
    mapping.fail('mcp', 'mcp must be an object when present');
  }
  const endpoint = compact<ProfileNetworkEndpoint>({
    host: mapping.string('host'),
    port: mapping.unsigned('port', U32_MAX, 'a port number'),
    protocol,
    tls: modeFromFile(TLS_MODES, mapping.string('tls', '')),
    access: modeFromFile(ACCESS_PRESETS, mapping.string('access', '')),
    enforcement: modeFromFile(
      ENFORCEMENT_MODES,
      mapping.string('enforcement', ''),
    ),
    rules: readRules(
      mapping,
      'rules',
      'rules list cannot be empty (would deny all traffic). Use `access: full` or remove rules.',
      (rule, rulePath) => {
        const entry = Mapping.of(rule, rulePath, unknown);
        const allow = entry.optional('allow', (allowed) =>
          readMatch(allowed, unknown, isMcp),
        );
        entry.done();
        return allow === undefined ? {} : { allow };
      },
    ),
    allowedIps: mapping.strings('allowed_ips'),
    ports: mapping.list('ports', (port, portPath) => {
      if (
        typeof port !== 'number' ||
        !Number.isInteger(port) ||
        port < 0 ||
        port > U32_MAX
      ) {
        throw new ProfileFileError(
          portPath,
          `invalid type: ${describe(port)}, expected a port number`,
        );
      }
      return port;
    }),
    denyRules: readRules(
      mapping,
      'deny_rules',
      'deny_rules list cannot be empty (would have no effect). Remove it if no denials are needed.',
      match,
    ),
    allowEncodedSlash: mapping.boolean('allow_encoded_slash'),
    websocketCredentialRewrite: mapping.boolean('websocket_credential_rewrite'),
    requestBodyCredentialRewrite: mapping.boolean(
      'request_body_credential_rewrite',
    ),
    allowUninspectedCredentials: mapping.boolean(
      'allow_uninspected_credentials',
    ),
    persistedQueries: mapping.string('persisted_queries', ''),
    graphqlPersistedQueries: mapping.map(
      'graphql_persisted_queries',
      (operation, operationPath): ProfileGraphqlOperation => {
        const entry = Mapping.of(operation, operationPath, unknown);
        const out = compact<ProfileGraphqlOperation>({
          operationType: entry.string('operation_type', ''),
          operationName: entry.string('operation_name', ''),
          fields: entry.strings('fields'),
        });
        entry.done();
        return out;
      },
    ),
    graphqlMaxBodyBytes: mapping.unsigned(
      'graphql_max_body_bytes',
      U32_MAX,
      'a size in bytes',
    ),
    jsonRpcMaxBodyBytes: mapping.unsigned(
      'json_rpc_max_body_bytes',
      U32_MAX,
      'a size in bytes',
    ),
    path: mapping.string('path', ''),
    credentialSigning: mapping.string('credential_signing', ''),
    signingService: mapping.string('signing_service', ''),
    signingRegion: mapping.string('signing_region', ''),
  });
  // Kept even when it sets nothing: an `mcp: {}` is the author asking for MCP
  // options, which the gateway answers with its defaults.
  const mcp = mapping.optional('mcp', readMcp);
  if (mcp !== undefined) {
    endpoint.mcp = mcp;
  }
  mapping.done();
  return endpoint;
};

const readRefresh = (
  mapping: Mapping,
  unknown: string[],
): ProfileCredentialRefresh => {
  const raw = mapping.string('strategy', '');
  const strategy = STRATEGY_FROM_FILE[enumKey(raw)];
  if (strategy === undefined) {
    mapping.fail('strategy', `unsupported provider refresh strategy: ${raw}`);
  }
  const refresh: ProfileCredentialRefresh = {
    strategy,
    ...compact<Partial<ProfileCredentialRefresh>>({
      tokenUrl: mapping.string('token_url', ''),
      scopes: mapping.strings('scopes'),
      material: mapping.list(
        'material',
        (value, path): ProfileRefreshMaterial => {
          const entry = Mapping.of(value, path, unknown);
          const description = entry.string('description', '');
          const material: ProfileRefreshMaterial = {
            name: entry.string('name'),
            required: entry.boolean('required'),
            secret: entry.boolean('secret'),
          };
          if (description) {
            material.description = description;
          }
          entry.done();
          return material;
        },
      ),
      additionalOutputs: mapping.list(
        'additional_outputs',
        (value, path): ProfileRefreshOutput => {
          const entry = Mapping.of(value, path, unknown);
          const output = {
            output: entry.string('output'),
            credential: entry.string('credential'),
          };
          entry.done();
          return output;
        },
      ),
    }),
  };
  // Not through compact: "0s" is a duration, and it is not the same as none.
  const refreshBefore = readDuration(mapping, 'refresh_before');
  const maxLifetime = readDuration(mapping, 'max_lifetime');
  if (refreshBefore !== undefined) {
    refresh.refreshBefore = refreshBefore;
  }
  if (maxLifetime !== undefined) {
    refresh.maxLifetime = maxLifetime;
  }
  mapping.done();
  return refresh;
};

const readTokenGrant = (
  mapping: Mapping,
  unknown: string[],
): ProfileTokenGrant => {
  const raw = mapping.string('grant_type', '');
  const grantType = GRANT_TYPE_FROM_FILE[enumKey(raw)];
  if (grantType === undefined) {
    mapping.fail('grant_type', `unsupported provider token grant type: ${raw}`);
  }
  const grant: ProfileTokenGrant = {
    grantType,
    tokenEndpoint: mapping.string('token_endpoint'),
    ...compact<Partial<ProfileTokenGrant>>({
      audience: mapping.string('audience', ''),
      jwtSvidAudience: mapping.string('jwt_svid_audience', ''),
      clientAssertionType: mapping.string('client_assertion_type', ''),
      scopes: mapping.strings('scopes'),
      requestedTokenType: mapping.string('requested_token_type', ''),
      audienceOverrides: mapping.list(
        'audience_overrides',
        (value, path): ProfileTokenGrantAudienceOverride => {
          const entry = Mapping.of(value, path, unknown);
          const override = {
            audience: entry.string('audience'),
            ...compact<Partial<ProfileTokenGrantAudienceOverride>>({
              host: entry.string('host', ''),
              port: entry.unsigned('port', U32_MAX, 'a port number'),
              path: entry.string('path', ''),
              scopes: entry.strings('scopes'),
            }),
          };
          entry.done();
          return override;
        },
      ),
    }),
  };
  const cacheTtl = readDuration(mapping, 'cache_ttl');
  if (cacheTtl !== undefined) {
    grant.cacheTtl = cacheTtl;
  }
  const subjectToken = mapping.optional('subject_token', (entry) => {
    const subject = {
      source: entry.string('source'),
      credential: entry.string('credential'),
      ...compact<{ subjectTokenType?: string }>({
        subjectTokenType: entry.string('subject_token_type', ''),
      }),
    };
    entry.done();
    return subject;
  });
  if (subjectToken !== undefined) {
    grant.subjectToken = subjectToken;
  }
  mapping.done();
  return grant;
};

const readCredential = (
  value: unknown,
  path: string,
  unknown: string[],
): ProfileCredential => {
  const mapping = Mapping.of(value, path, unknown);
  const credential: ProfileCredential = {
    name: mapping.string('name'),
    required: mapping.boolean('required'),
    ...compact<Partial<ProfileCredential>>({
      description: mapping.string('description', ''),
      envVars: mapping.strings('env_vars'),
      authStyle: mapping.string('auth_style', ''),
      headerName: mapping.string('header_name', ''),
      queryParam: mapping.string('query_param', ''),
      pathTemplate: mapping.string('path_template', ''),
    }),
  };
  const refresh = mapping.optional('refresh', (entry) =>
    readRefresh(entry, unknown),
  );
  const tokenGrant = mapping.optional('token_grant', (entry) =>
    readTokenGrant(entry, unknown),
  );
  if (refresh !== undefined) {
    credential.refresh = refresh;
  }
  if (tokenGrant !== undefined) {
    credential.tokenGrant = tokenGrant;
  }
  mapping.done();
  return credential;
};

// A file the provider serves to its sandboxes: its name, the template of its
// content and, when it has one, the environment variable that is given its
// path. The content is kept as it is written, an empty one included.
const readProviderFile = (
  value: unknown,
  path: string,
  unknown: string[],
): ProfileFile => {
  const mapping = Mapping.of(value, path, unknown);
  const file: ProfileFile = {
    path: mapping.string('path'),
    content: mapping.string('content'),
    ...compact<Partial<ProfileFile>>({
      envVar: mapping.string('env_var', ''),
    }),
  };
  mapping.done();
  return file;
};

// A binary is its path, written bare or as `path:` in a mapping that holds
// nothing else.
const readBinary = (value: unknown, path: string): ProfileBinary => {
  if (typeof value === 'string') {
    return { path: value };
  }
  const mapping = Mapping.of(value, path, []);
  const binary = { path: mapping.string('path') };
  const extra = mapping.done().sort();
  if (extra.length > 0) {
    throw new ProfileFileError(
      path,
      `unsupported provider profile binary fields: ${extra.join(', ')}; binaries accept only 'path' and the deprecated 'harness' field was removed in 0.1.0`,
    );
  }
  return binary;
};

// profileFromDocument converts a profile document, the parsed content of a
// profile file, to the profile the BFF takes. `unknown` collects the fields
// of the document the schema does not have.
export const profileFromDocument = (
  document: unknown,
  unknown: string[] = [],
): ImportProfileRequest => {
  const mapping = Mapping.of(document, '', unknown);
  const rawCategory = mapping.string('category', '');
  const category = CATEGORY_FROM_FILE[enumKey(rawCategory)];
  if (category === undefined) {
    mapping.fail(
      'category',
      `unsupported provider profile category: ${rawCategory}`,
    );
  }
  const profile: ImportProfileRequest = {
    id: mapping.string('id'),
    displayName: mapping.string('display_name'),
    category,
    inferenceCapable: mapping.boolean('inference_capable'),
    ...compact<Partial<ImportProfileRequest>>({
      resourceVersion: mapping.unsigned(
        'resource_version',
        Number.MAX_SAFE_INTEGER,
        'a resource version',
      ),
      annotations: mapping.map('annotations', (value, path) => {
        if (typeof value !== 'string') {
          throw new ProfileFileError(
            path,
            `invalid type: ${describe(value)}, expected a string`,
          );
        }
        return value;
      }),
      description: mapping.string('description', ''),
      credentials: mapping.list('credentials', (value, path) =>
        readCredential(value, path, unknown),
      ),
      files: mapping.list('files', (value, path) =>
        readProviderFile(value, path, unknown),
      ),
      networkEndpoints: mapping.list('endpoints', (value, path) =>
        readEndpoint(value, path, unknown),
      ),
      binaries: mapping.list('binaries', readBinary),
      source: mapping.string('source', ''),
      scope: mapping.string('scope', ''),
    }),
  };
  const discovery = mapping.optional('discovery', (entry) => {
    const credentials = entry.strings('credentials');
    entry.done();
    return credentials;
  });
  if (discovery !== undefined && discovery.length > 0) {
    profile.discovery = { credentials: discovery };
  }
  mapping.done();
  return profile;
};

const fileDiagnostic = (
  source: string,
  message: string,
  severity: 'error' | 'warning',
  profileId = '',
): ProfileDiagnostic => ({
  source,
  profileId,
  field: 'file',
  message,
  severity,
});

// The document a profile file holds: its one YAML document, or its JSON.
const readDocument = (text: string, format: ProfileFileFormat): unknown => {
  if (format === 'json') {
    return JSON.parse(text);
  }
  // YAML 1.2, which is what upstream reads: `no` is a string and `2025-11-25`
  // is not a date.
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    lineCounter,
  });
  if (document.errors.length > 0) {
    throw new Error(document.errors[0].message);
  }
  // A merge key is `<<` written plain, as a key. Quoted it is text, and a key
  // like any other where the keys are the author's own.
  visit(document, {
    Pair(_key, pair) {
      const key = pair.key;
      if (isScalar(key) && key.value === '<<' && key.type === Scalar.PLAIN) {
        const { line, col } = lineCounter.linePos(key.range?.[0] ?? 0);
        throw new Error(
          `merge keys (\`<<\`) are not supported in a provider profile file (line ${line}, column ${col}): write out the fields the entry is meant to take from its anchor`,
        );
      }
    },
  });
  return document.toJS();
};

// parseProfileFile reads a profile file. `source` names the file in the
// diagnostics and in the profile's importSource, which the gateway repeats in
// its own diagnostics; the CLI uses the file's path.
//
// A file that is not a profile yields no profile and one error. A profile with
// fields the schema does not have is still a profile; each such field is a
// warning.
export const parseProfileFile = (
  text: string,
  format: ProfileFileFormat,
  source: string,
): ParsedProfileFile => {
  const unknown: string[] = [];
  try {
    const profile = profileFromDocument(readDocument(text, format), unknown);
    profile.importSource = source;
    return {
      profile,
      diagnostics: unknown.map((field) =>
        fileDiagnostic(
          source,
          `unknown field \`${field}\` is not part of a provider profile and is ignored`,
          'warning',
          profile.id,
        ),
      ),
    };
  } catch (error) {
    const where =
      error instanceof ProfileFileError && error.path ? `${error.path}: ` : '';
    const kind = format === 'json' ? 'JSON' : 'YAML';
    return {
      diagnostics: [
        fileDiagnostic(
          source,
          `failed to parse provider profile ${kind}: ${where}${(error as Error).message}`,
          'error',
        ),
      ],
    };
  }
};

// --- Writing a file ---

// A profile that can be written to a file: one the BFF returned, or one that
// was read from a file.
export type ExportableProfile = Pick<
  ImportProfileRequest,
  | 'id'
  | 'displayName'
  | 'description'
  | 'category'
  | 'credentials'
  | 'files'
  | 'networkEndpoints'
  | 'binaries'
  | 'discovery'
  | 'annotations'
  | 'inferenceCapable'
  | 'resourceVersion'
  | 'source'
  | 'scope'
>;

// Whether a profile the BFF returned can be exported. One that lists
// endpoints and does not have them whole cannot: the file would be a profile
// whose endpoints allow nothing in particular, and importing it would say so
// to the gateway.
export const isProfileExportable = (profile: ProviderProfile): boolean =>
  (profile.endpoints ?? []).length === 0 ||
  profile.networkEndpoints !== undefined;

// Adds a field to a document when upstream would write it: always, or only
// when it holds something.
const put = (doc: Doc, key: string, value: unknown, always = false): void => {
  const empty =
    value === undefined ||
    value === '' ||
    value === false ||
    value === 0 ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0);
  if (always || !empty) {
    doc[key] = value;
  }
};

const writeMatcher = (matcher: L7QueryMatcher): Doc => {
  const doc: Doc = {};
  put(doc, 'glob', matcher.glob ?? '');
  put(doc, 'any', matcher.any ?? []);
  return doc;
};

const writeMatchers = (matchers: Record<string, L7QueryMatcher> = {}): Doc =>
  Object.fromEntries(
    Object.entries(matchers).map(([name, matcher]) => [
      name,
      writeMatcher(matcher),
    ]),
  );

const writeMatch = (match: ProfileL7Match): Doc => {
  const doc: Doc = {};
  put(doc, 'method', match.method ?? '');
  put(doc, 'path', match.path ?? '');
  put(doc, 'command', match.command ?? '');
  put(doc, 'query', writeMatchers(match.query));
  put(doc, 'operation_type', match.operationType ?? '');
  put(doc, 'operation_name', match.operationName ?? '');
  put(doc, 'fields', match.fields ?? []);
  put(doc, 'params', writeMatchers(match.params));
  return doc;
};

const writeEndpoint = (endpoint: ProfileNetworkEndpoint): Doc => {
  const doc: Doc = {};
  put(doc, 'host', endpoint.host ?? '', true);
  put(doc, 'port', endpoint.port ?? 0);
  put(doc, 'protocol', endpoint.protocol ?? '');
  put(
    doc,
    'tls',
    modeToFile(TLS_MODES, 'NETWORK_TLS_MODE_UNSPECIFIED', endpoint.tls),
  );
  put(doc, 'access', accessPresetName(endpoint.access));
  put(
    doc,
    'enforcement',
    modeToFile(
      ENFORCEMENT_MODES,
      'NETWORK_ENFORCEMENT_MODE_UNSPECIFIED',
      endpoint.enforcement,
    ),
  );
  put(
    doc,
    'rules',
    (endpoint.rules ?? []).map((rule) =>
      rule.allow ? { allow: writeMatch(rule.allow) } : {},
    ),
  );
  put(doc, 'allowed_ips', endpoint.allowedIps ?? []);
  put(doc, 'ports', endpoint.ports ?? []);
  put(doc, 'deny_rules', (endpoint.denyRules ?? []).map(writeMatch));
  put(doc, 'allow_encoded_slash', endpoint.allowEncodedSlash ?? false);
  put(
    doc,
    'websocket_credential_rewrite',
    endpoint.websocketCredentialRewrite ?? false,
  );
  put(
    doc,
    'request_body_credential_rewrite',
    endpoint.requestBodyCredentialRewrite ?? false,
  );
  put(
    doc,
    'allow_uninspected_credentials',
    endpoint.allowUninspectedCredentials ?? false,
  );
  put(doc, 'persisted_queries', endpoint.persistedQueries ?? '');
  put(
    doc,
    'graphql_persisted_queries',
    Object.fromEntries(
      Object.entries(endpoint.graphqlPersistedQueries ?? {}).map(
        ([name, operation]) => {
          const entry: Doc = {};
          put(entry, 'operation_type', operation.operationType ?? '');
          put(entry, 'operation_name', operation.operationName ?? '');
          put(entry, 'fields', operation.fields ?? []);
          return [name, entry];
        },
      ),
    ),
  );
  put(doc, 'graphql_max_body_bytes', endpoint.graphqlMaxBodyBytes ?? 0);
  put(doc, 'json_rpc_max_body_bytes', endpoint.jsonRpcMaxBodyBytes ?? 0);
  if (endpoint.mcp !== undefined) {
    const mcp: Doc = {};
    put(mcp, 'versions', endpoint.mcp.versions ?? []);
    // Written whenever set, false included: unset is not false here.
    if (endpoint.mcp.strictToolNames !== undefined) {
      mcp.strict_tool_names = endpoint.mcp.strictToolNames;
    }
    if (endpoint.mcp.allowAllKnownMcpMethods !== undefined) {
      mcp.allow_all_known_mcp_methods = endpoint.mcp.allowAllKnownMcpMethods;
    }
    doc.mcp = mcp;
  }
  put(doc, 'path', endpoint.path ?? '');
  put(doc, 'credential_signing', endpoint.credentialSigning ?? '');
  put(doc, 'signing_service', endpoint.signingService ?? '');
  put(doc, 'signing_region', endpoint.signingRegion ?? '');
  return doc;
};

const writeRefresh = (refresh: ProfileCredentialRefresh): Doc => {
  const doc: Doc = {
    strategy: refreshStrategyName(refresh.strategy),
  };
  put(doc, 'token_url', refresh.tokenUrl ?? '');
  put(doc, 'scopes', refresh.scopes ?? []);
  // A duration that is set is written, "0s" included.
  if (refresh.refreshBefore !== undefined) {
    doc.refresh_before = refresh.refreshBefore;
  }
  if (refresh.maxLifetime !== undefined) {
    doc.max_lifetime = refresh.maxLifetime;
  }
  put(
    doc,
    'material',
    (refresh.material ?? []).map((material) => {
      const entry: Doc = { name: material.name };
      put(entry, 'description', material.description ?? '');
      entry.required = material.required;
      entry.secret = material.secret;
      return entry;
    }),
  );
  put(
    doc,
    'additional_outputs',
    (refresh.additionalOutputs ?? []).map((output) => ({
      output: output.output,
      credential: output.credential,
    })),
  );
  return doc;
};

const writeTokenGrant = (grant: ProfileTokenGrant): Doc => {
  const doc: Doc = {};
  // client_credentials is what an unset grant type means, and is not written.
  if (grant.grantType === 'TOKEN_EXCHANGE') {
    doc.grant_type = 'token_exchange';
  }
  doc.token_endpoint = grant.tokenEndpoint;
  put(doc, 'audience', grant.audience ?? '');
  put(doc, 'jwt_svid_audience', grant.jwtSvidAudience ?? '');
  put(doc, 'client_assertion_type', grant.clientAssertionType ?? '');
  put(doc, 'scopes', grant.scopes ?? []);
  if (grant.cacheTtl !== undefined) {
    doc.cache_ttl = grant.cacheTtl;
  }
  put(
    doc,
    'audience_overrides',
    (grant.audienceOverrides ?? []).map((override) => {
      const entry: Doc = {};
      put(entry, 'host', override.host ?? '');
      put(entry, 'port', override.port ?? 0);
      put(entry, 'path', override.path ?? '');
      entry.audience = override.audience;
      put(entry, 'scopes', override.scopes ?? []);
      return entry;
    }),
  );
  if (grant.subjectToken !== undefined) {
    const subject: Doc = {
      source: grant.subjectToken.source,
      credential: grant.subjectToken.credential,
    };
    put(subject, 'subject_token_type', grant.subjectToken.subjectTokenType);
    doc.subject_token = subject;
  }
  put(doc, 'requested_token_type', grant.requestedTokenType ?? '');
  return doc;
};

const writeCredential = (credential: ProfileCredential): Doc => {
  // Upstream writes these seven whether or not they hold anything.
  const doc: Doc = {
    name: credential.name,
    description: credential.description ?? '',
    env_vars: credential.envVars ?? [],
    required: credential.required,
    auth_style: credential.authStyle ?? '',
    header_name: credential.headerName ?? '',
    query_param: credential.queryParam ?? '',
  };
  if (credential.refresh !== undefined) {
    doc.refresh = writeRefresh(credential.refresh);
  }
  put(doc, 'path_template', credential.pathTemplate ?? '');
  if (credential.tokenGrant !== undefined) {
    doc.token_grant = writeTokenGrant(credential.tokenGrant);
  }
  return doc;
};

const writeProviderFile = (file: ProfileFile): Doc => {
  const doc: Doc = { path: file.path, content: file.content };
  put(doc, 'env_var', file.envVar ?? '');
  return doc;
};

// profileToDocument converts a profile to the document a profile file holds,
// with the fields in the order upstream writes them and the same ones left
// out when they hold nothing.
export const profileToDocument = (profile: ExportableProfile): Doc => {
  const doc: Doc = { id: profile.id };
  put(doc, 'resource_version', profile.resourceVersion ?? 0);
  put(doc, 'annotations', profile.annotations ?? {});
  doc.display_name = profile.displayName;
  doc.description = profile.description ?? '';
  doc.category = profileCategoryName(profile.category);
  doc.credentials = (profile.credentials ?? []).map(writeCredential);
  put(doc, 'files', (profile.files ?? []).map(writeProviderFile));
  doc.endpoints = (profile.networkEndpoints ?? []).map(writeEndpoint);
  doc.binaries = (profile.binaries ?? []).map((binary) => binary.path);
  doc.inference_capable = profile.inferenceCapable;
  if ((profile.discovery?.credentials ?? []).length > 0) {
    doc.discovery = { credentials: profile.discovery?.credentials };
  }
  put(doc, 'source', profile.source ?? '');
  put(doc, 'scope', profile.scope ?? '');
  return doc;
};

// serializeProfileFile writes a profile as a profile file: what `openshell
// provider profile export -o yaml|json` prints for it. The resource version is
// in the file, which is what lets the file be sent back as an update.
export const serializeProfileFile = (
  profile: ExportableProfile,
  format: ProfileFileFormat,
): string => {
  const document = profileToDocument(profile);
  if (format === 'json') {
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  // No line folding: a folded token URL is still valid YAML and much harder
  // to read and to diff.
  return stringify(document, { lineWidth: 0 });
};
