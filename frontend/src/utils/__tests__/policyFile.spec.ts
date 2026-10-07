import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

import {
  findUnknownFields,
  hasGatewayMarks,
  parsePolicyFile,
  policyFromDocument,
  policyTextFormat,
  policyToDocument,
  policyToText,
  readPolicyText,
  serializePolicyFile,
} from '../policyFile';
import type {
  L7QueryMatcher,
  NetworkEndpoint,
  SandboxPolicy,
} from '../../types';

const FIXTURES = join(__dirname, 'fixtures', 'policies');

const fixture = (path: string): string =>
  readFileSync(join(FIXTURES, path), 'utf8');

// Every policy file under a directory of the fixtures.
const filesUnder = (dir: string): string[] =>
  readdirSync(join(FIXTURES, dir)).flatMap((name) => {
    const path = dir ? `${dir}/${name}` : name;
    if (statSync(join(FIXTURES, path)).isDirectory()) {
      return filesUnder(path);
    }
    return /\.ya?ml$/.test(name) ? [path] : [];
  });

// The policy a file holds, which the test expects to be one.
const read = (text: string): SandboxPolicy => {
  const parsed = parsePolicyFile(text);
  if (!parsed.policy) {
    throw new Error(parsed.diagnostics.map((d) => d.message).join('; '));
  }
  expect(parsed.diagnostics).toEqual([]);
  return parsed.policy;
};

// Why a file that is not a policy is refused.
const refusal = (text: string): string => {
  const parsed = parsePolicyFile(text);
  expect(parsed.policy).toBeUndefined();
  expect(parsed.diagnostics.length).toBeGreaterThan(0);
  return parsed.diagnostics.map((d) => d.message).join('\n');
};

// The file a policy is written as, which the test expects it can be.
const write = (
  policy: SandboxPolicy,
  format: 'yaml' | 'json' = 'yaml',
): string => {
  const written = serializePolicyFile(policy, format);
  if (written.text === undefined) {
    throw new Error(written.diagnostics.map((d) => d.message).join('; '));
  }
  return written.text;
};

// Why a policy cannot be written as a file.
const unwritable = (policy: SandboxPolicy): string => {
  const written = serializePolicyFile(policy, 'yaml');
  expect(written.text).toBeUndefined();
  expect(written.diagnostics.length).toBeGreaterThan(0);
  return written.diagnostics.map((d) => d.message).join('\n');
};

const ENDPOINT = `version: 1
network_policies:
  api:
    endpoints:
      - host: a.example
`;

// One endpoint of an otherwise minimal policy. `yaml` is the rest of its
// fields, indented by eight.
const withEndpoint = (yaml: string): NetworkEndpoint => {
  const endpoint = read(`${ENDPOINT}${yaml}`).networkPolicies?.api
    .endpoints?.[0];
  if (!endpoint) {
    throw new Error('the policy has no endpoint');
  }
  return endpoint;
};

// A policy of one rule, `api`, with one endpoint.
const policyOf = (endpoint: NetworkEndpoint): SandboxPolicy => ({
  version: 1,
  networkPolicies: { api: { name: 'api', endpoints: [endpoint] } },
});

type Doc = Record<string, unknown>;

// The first endpoint of the rule `api` in a policy file.
const endpointIn = (yaml: string): Doc =>
  (
    parseYaml(yaml) as {
      network_policies: { api: { endpoints: Doc[] } };
    }
  ).network_policies.api.endpoints[0];

// --- Upstream's own policy files ---

const DEFAULT_MCP_VERSION = '2025-11-25';

const isEmpty = (value: unknown): boolean =>
  value === '' ||
  value === false ||
  value === 0 ||
  value === null ||
  value === undefined ||
  (typeof value === 'object' && Object.keys(value as object).length === 0);

// A value with every field that holds nothing left out.
const pruned = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(pruned);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out: Doc = {};
  for (const [key, field] of Object.entries(value)) {
    const kept = pruned(field);
    if (!isEmpty(kept)) {
      out[key] = kept;
    }
  }
  return out;
};

// A policy document with what upstream reads the same way made the same: a
// rule and a middleware named by their keys, one port the same as a list of
// one, the default landlock mode and the default MCP revision written out,
// revisions in order, and a field holding nothing the same as a field left
// out. What is left differs only if a field or a value was lost or changed.
const canonical = (text: string): unknown => {
  const doc = parseYaml(text) as {
    landlock?: { compatibility?: string };
    network_policies?: Record<
      string,
      {
        name?: string;
        endpoints?: {
          port?: number;
          ports?: number[];
          protocol?: string;
          mcp?: { versions?: string[] };
        }[];
      }
    >;
    network_middlewares?: Record<string, { name?: string }>;
  };
  if (doc.landlock) {
    doc.landlock.compatibility ??= 'best_effort';
  }
  for (const [key, rule] of Object.entries(doc.network_policies ?? {})) {
    rule.name ??= key;
    for (const endpoint of rule.endpoints ?? []) {
      endpoint.ports = endpoint.ports?.length
        ? endpoint.ports
        : endpoint.port
          ? [endpoint.port]
          : [];
      delete endpoint.port;
      if (endpoint.protocol?.toLowerCase() === 'mcp') {
        endpoint.mcp = {
          ...endpoint.mcp,
          versions: [
            ...(endpoint.mcp?.versions ?? [DEFAULT_MCP_VERSION]),
          ].sort(),
        };
      }
    }
  }
  for (const [key, middleware] of Object.entries(
    doc.network_middlewares ?? {},
  )) {
    middleware.name ??= key;
  }
  return pruned(doc);
};

describe('upstream policy files', () => {
  const all = filesUnder('');
  // Not YAML until its placeholders are filled in.
  const TEMPLATE = 'e2e/mcp-conformance/policy-template.yaml';
  const policies = all.filter((path) => path !== TEMPLATE);

  it('has every policy file upstream has at v0.1.2', () => {
    expect(all).toHaveLength(29);
    expect(filesUnder('examples')).toHaveLength(8);
  });

  it.each(policies)('%s is read whole and written back whole', (path) => {
    const text = fixture(path);
    const parsed = parsePolicyFile(text);
    // No error, and so no field the schema does not have: every field these
    // files use is one the dashboard understands.
    expect(parsed.diagnostics).toEqual([]);
    const policy = parsed.policy as SandboxPolicy;

    // File -> policy -> file: the document that is written says what the
    // document that was read said.
    const written = write(policy);
    expect(canonical(written)).toEqual(canonical(text));

    // Policy -> file -> policy, in both formats: nothing is lost on the way
    // out and back in either, and the file that is written is the one that
    // is written from then on.
    for (const format of ['yaml', 'json'] as const) {
      const file = write(policy, format);
      const again = read(file);
      expect(again).toEqual(policy);
      expect(write(again, format)).toBe(file);
    }
  });

  it('refuses the template that is not YAML yet', () => {
    expect(refusal(fixture(TEMPLATE))).toMatch(
      /^failed to parse sandbox policy YAML: .* at line 37, column 1$/,
    );
  });

  // What the API has to hold for a file, worked out by hand from to_proto.

  it('reads examples/sandbox-policy-quickstart/policy.yaml as the policy it is', () => {
    expect(
      read(fixture('examples/sandbox-policy-quickstart/policy.yaml')),
    ).toEqual({
      version: 1,
      filesystem: {
        includeWorkdir: true,
        readOnly: [
          '/bin',
          '/usr',
          '/lib',
          '/proc',
          '/dev/urandom',
          '/app',
          '/etc',
          '/var/log',
        ],
        readWrite: ['/sandbox', '/tmp', '/dev/null'],
      },
      landlock: { compatibility: 'best_effort' },
      networkPolicies: {
        github_api: {
          name: 'github-api-readonly',
          endpoints: [
            {
              host: 'api.github.com',
              // One port is both `port` and the one entry of `ports`.
              port: 443,
              ports: [443],
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
            },
          ],
          binaries: [{ path: '/usr/bin/curl' }],
        },
      },
    });
  });

  it('reads the revisions of crates/openshell-policy/testdata/mcp-version-profiles.yaml into order', () => {
    const text = fixture(
      'crates/openshell-policy/testdata/mcp-version-profiles.yaml',
    );
    // The file lists them newest first.
    expect(text.indexOf('2025-11-25')).toBeLessThan(text.indexOf('2025-03-26'));
    expect(read(text)).toEqual({
      version: 1,
      networkPolicies: {
        versioned_mcp: {
          name: 'versioned_mcp',
          endpoints: [
            {
              host: 'mcp.example.com',
              port: 443,
              ports: [443],
              protocol: 'mcp',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              rules: [{ allow: { method: 'initialize' } }],
              mcp: { versions: ['2025-03-26', '2025-06-18', '2025-11-25'] },
            },
          ],
          binaries: [{ path: '/usr/bin/mcp-client' }],
        },
      },
    });
    // mcp_version_profile_fixture_round_trips_in_canonical_order
    const written = write(read(text));
    expect(written.indexOf('2025-03-26')).toBeLessThan(
      written.indexOf('2025-06-18'),
    );
    expect(written.indexOf('2025-06-18')).toBeLessThan(
      written.indexOf('2025-11-25'),
    );
  });

  it('reads the middleware of examples/supervisor-middleware-content-guard/policy.yaml', () => {
    const policy = read(
      fixture('examples/supervisor-middleware-content-guard/policy.yaml'),
    );
    expect(policy.networkMiddlewares).toEqual({
      'prototype-content-guard': {
        name: 'Prototype content guard',
        middleware: 'content-guard-example',
        order: 10,
        config: {
          mode: 'redact',
          terms: ['prototype-secret', 'internal-only'],
          replacement: '[FILTERED]',
        },
        onError: 'fail_closed',
        endpoints: { include: ['httpbin.org', 'host.openshell.internal'] },
      },
    });
    expect(Object.keys(policy.networkPolicies ?? {}).sort()).toEqual([
      'guard-responses',
      'httpbin',
      'httpbingo',
    ]);
    expect(policy.networkPolicies?.['guard-responses']).toEqual({
      name: 'Guard responses',
      endpoints: [
        {
          host: 'host.openshell.internal',
          port: 18081,
          ports: [18081],
          protocol: 'rest',
          rules: [
            { allow: { method: 'GET', path: '/clean' } },
            { allow: { method: 'GET', path: '/sensitive' } },
          ],
        },
      ],
      binaries: [{ path: '/usr/bin/curl' }],
    });
    // No filesystem section in the file is none in the policy.
    expect(policy).not.toHaveProperty('filesystem');
  });

  it('reads examples/transparent-tcp-redis/policy.yaml, a native TCP endpoint', () => {
    expect(
      read(fixture('examples/transparent-tcp-redis/policy.yaml'))
        .networkPolicies,
    ).toEqual({
      redis: {
        name: 'redis-native-tcp',
        endpoints: [
          {
            host: 'redis.openshell.demo',
            port: 6379,
            ports: [6379],
            protocol: 'tcp',
            allowedIps: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
          },
        ],
        binaries: [{ path: '/**' }],
      },
    });
  });

  it('reads a filesystem section that grants nothing as one that is there', () => {
    // include_workdir: false and two empty lists: default-deny, which is not
    // the same as no section, whose default includes the workdir.
    expect(
      read(
        fixture(
          'crates/openshell-driver-mxc/examples/e2e-policies/fs-empty.yaml',
        ),
      ),
    ).toEqual({ version: 1, filesystem: {} });
    expect(
      read(fixture('crates/openshell-prover/testdata/empty-policy.yaml')),
    ).toEqual({ version: 1 });
  });

  it('names a rule by its key when it names itself nothing', () => {
    const policy = read(fixture('docs/policy-schema-full-example.yaml'));
    expect(policy.networkPolicies?.npm_registry).toEqual({
      name: 'npm_registry',
      endpoints: [
        {
          host: 'registry.npmjs.org',
          port: 443,
          ports: [443],
          protocol: 'rest',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
          allowEncodedSlash: true,
        },
      ],
      binaries: [{ path: '/usr/bin/node' }],
    });
  });
});

// --- Every field ---

// A policy file that sets every field of upstream's schema at least once.
const EVERY_FIELD = `version: 1
filesystem_policy:
  include_workdir: true
  read_only: [/usr, /etc]
  read_write: [/tmp]
landlock:
  compatibility: hard_requirement
process:
  run_as_user: "1500"
  run_as_group: sandbox
network_policies:
  rest_api:
    name: REST API
    endpoints:
      - host: api.example.com
        path: /v1/**
        port: 443
        protocol: rest
        tls: skip
        enforcement: enforce
        rules:
          - allow:
              method: GET
              path: /v1/projects/**
              query:
                tag: "prod-*"
                env:
                  any: ["a-*", "b-*"]
        allowed_ips: ["10.0.5.0/24"]
        deny_rules:
          - method: DELETE
            path: /v1/projects/**
        allow_encoded_slash: true
        websocket_credential_rewrite: true
        request_body_credential_rewrite: true
        allow_uninspected_credentials: true
        credential_signing: sigv4
        signing_service: bedrock
        signing_region: us-east-1
        credential_binding:
          provider: work-aws
      - host: sql.example.com
        ports: [5432, 5433]
        protocol: sql
        access: read-write
        rules:
          - allow:
              command: SELECT
    binaries:
      - path: /usr/bin/curl
  graphql_api:
    endpoints:
      - host: graphql.example.com
        port: 443
        protocol: graphql
        persisted_queries: allow_registered
        graphql_persisted_queries:
          abc123:
            operation_type: query
            operation_name: Viewer
            fields: [viewer]
        graphql_max_body_bytes: 131072
        rules:
          - allow:
              operation_type: mutation
              operation_name: Issue*
              fields: [createIssue]
  rpc:
    endpoints:
      - host: rpc.example.com
        port: 443
        protocol: json-rpc
        json_rpc:
          max_body_bytes: 4096
        rules:
          - allow:
              method: reports.search
  mcp:
    endpoints:
      - host: mcp.example.com
        port: 443
        protocol: mcp
        mcp:
          versions: ["2025-06-18", "2025-03-26"]
          max_body_bytes: 131072
          strict_tool_names: false
          allow_all_known_mcp_methods: false
        rules:
          - allow:
              method: tools/call
              tool:
                any: [search_web, list_issues]
              params:
                arguments:
                  repo: "NVIDIA/*"
network_middlewares:
  redactor:
    name: Redactor
    middleware: openshell/regex
    order: 20
    config:
      mode: redact
      limits: { depth: 3, ratio: 0.5, strict: true, label: null }
    on_error: fail_open
    endpoints:
      include: ["*.example.com"]
      exclude: ["trusted.example.com"]
`;

// The fields upstream's schema has, read from the lists it checks a file
// against (inspect_document and inspect_endpoint in the schema crate). The
// names under a map, and the nested params, are the file's own.
const SCHEMA_FIELDS = [
  'version',
  'filesystem_policy',
  'filesystem_policy.include_workdir',
  'filesystem_policy.read_only',
  'filesystem_policy.read_write',
  'landlock',
  'landlock.compatibility',
  'process',
  'process.run_as_user',
  'process.run_as_group',
  'network_policies',
  'network_policies.*.name',
  'network_policies.*.endpoints',
  'network_policies.*.binaries',
  'network_policies.*.binaries.path',
  ...[
    'host',
    'path',
    'port',
    'ports',
    'protocol',
    'tls',
    'enforcement',
    'access',
    'rules',
    'rules.allow',
    'allowed_ips',
    'deny_rules',
    'allow_encoded_slash',
    'websocket_credential_rewrite',
    'request_body_credential_rewrite',
    'allow_uninspected_credentials',
    'persisted_queries',
    'graphql_persisted_queries',
    'graphql_persisted_queries.*.operation_type',
    'graphql_persisted_queries.*.operation_name',
    'graphql_persisted_queries.*.fields',
    'graphql_max_body_bytes',
    'credential_signing',
    'signing_service',
    'signing_region',
    'credential_binding',
    'credential_binding.provider',
    'json_rpc',
    'json_rpc.max_body_bytes',
    'mcp',
    'mcp.versions',
    'mcp.max_body_bytes',
    'mcp.strict_tool_names',
    'mcp.allow_all_known_mcp_methods',
  ].map((field) => `network_policies.*.endpoints.${field}`),
  ...[
    'method',
    'path',
    'command',
    'query',
    'query.*.any',
    'operation_type',
    'operation_name',
    'fields',
    'tool',
    'tool.any',
    'params',
  ].map((field) => `network_policies.*.endpoints.rules.allow.${field}`),
  'network_policies.*.endpoints.deny_rules.method',
  'network_policies.*.endpoints.deny_rules.path',
  'network_middlewares',
  'network_middlewares.*.name',
  'network_middlewares.*.middleware',
  'network_middlewares.*.order',
  'network_middlewares.*.config',
  'network_middlewares.*.on_error',
  'network_middlewares.*.endpoints',
  'network_middlewares.*.endpoints.include',
  'network_middlewares.*.endpoints.exclude',
];

// The mappings whose keys are names a file chooses, not fields of the schema.
const NAMED =
  /(network_policies|network_middlewares|query|graphql_persisted_queries)$/;
// The mappings whose content is the file's own entirely.
const OPEN = /(config|params)$/;

// The fields a document sets, by path, with a `*` for a name.
const fieldsOf = (value: unknown, path = '', out = new Set<string>()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => fieldsOf(item, path, out));
  } else if (value !== null && typeof value === 'object' && !OPEN.test(path)) {
    for (const [key, field] of Object.entries(value)) {
      const next = NAMED.test(path)
        ? `${path}.*`
        : path
          ? `${path}.${key}`
          : key;
      if (!NAMED.test(path)) {
        out.add(next);
      }
      fieldsOf(field, next, out);
    }
  }
  return out;
};

describe('every field', () => {
  it('has a file that sets every field of the schema', () => {
    expect([...fieldsOf(parseYaml(EVERY_FIELD))].sort()).toEqual(
      [...SCHEMA_FIELDS].sort(),
    );
    expect(findUnknownFields(parseYaml(EVERY_FIELD))).toEqual([]);
  });

  it('reads every field of the schema into the policy', () => {
    expect(read(EVERY_FIELD)).toEqual({
      version: 1,
      filesystem: {
        includeWorkdir: true,
        readOnly: ['/usr', '/etc'],
        readWrite: ['/tmp'],
      },
      landlock: { compatibility: 'hard_requirement' },
      process: { runAsUser: '1500', runAsGroup: 'sandbox' },
      networkPolicies: {
        rest_api: {
          name: 'REST API',
          endpoints: [
            {
              host: 'api.example.com',
              path: '/v1/**',
              port: 443,
              ports: [443],
              protocol: 'rest',
              tls: 'NETWORK_TLS_MODE_SKIP',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              rules: [
                {
                  allow: {
                    method: 'GET',
                    path: '/v1/projects/**',
                    query: {
                      tag: { glob: 'prod-*' },
                      env: { any: ['a-*', 'b-*'] },
                    },
                  },
                },
              ],
              allowedIps: ['10.0.5.0/24'],
              denyRules: [{ method: 'DELETE', path: '/v1/projects/**' }],
              allowEncodedSlash: true,
              websocketCredentialRewrite: true,
              requestBodyCredentialRewrite: true,
              allowUninspectedCredentials: true,
              credentialSigning: 'sigv4',
              signingService: 'bedrock',
              signingRegion: 'us-east-1',
              credentialBinding: { provider: 'work-aws' },
            },
            {
              host: 'sql.example.com',
              port: 5432,
              ports: [5432, 5433],
              protocol: 'sql',
              access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
              rules: [{ allow: { command: 'SELECT' } }],
            },
          ],
          binaries: [{ path: '/usr/bin/curl' }],
        },
        graphql_api: {
          name: 'graphql_api',
          endpoints: [
            {
              host: 'graphql.example.com',
              port: 443,
              ports: [443],
              protocol: 'graphql',
              persistedQueries: 'allow_registered',
              graphqlPersistedQueries: {
                abc123: {
                  operationType: 'query',
                  operationName: 'Viewer',
                  fields: ['viewer'],
                },
              },
              graphqlMaxBodyBytes: 131072,
              rules: [
                {
                  allow: {
                    operationType: 'mutation',
                    operationName: 'Issue*',
                    fields: ['createIssue'],
                  },
                },
              ],
            },
          ],
        },
        rpc: {
          name: 'rpc',
          endpoints: [
            {
              host: 'rpc.example.com',
              port: 443,
              ports: [443],
              protocol: 'json-rpc',
              jsonRpcMaxBodyBytes: 4096,
              rules: [{ allow: { method: 'reports.search' } }],
            },
          ],
        },
        mcp: {
          name: 'mcp',
          endpoints: [
            {
              host: 'mcp.example.com',
              port: 443,
              ports: [443],
              protocol: 'mcp',
              jsonRpcMaxBodyBytes: 131072,
              mcp: {
                strictToolNames: false,
                allowAllKnownMcpMethods: false,
                versions: ['2025-03-26', '2025-06-18'],
              },
              rules: [
                {
                  allow: {
                    method: 'tools/call',
                    params: {
                      name: { any: ['search_web', 'list_issues'] },
                      'arguments.repo': { glob: 'NVIDIA/*' },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      networkMiddlewares: {
        redactor: {
          name: 'Redactor',
          middleware: 'openshell/regex',
          order: 20,
          config: {
            mode: 'redact',
            limits: { depth: 3, ratio: 0.5, strict: true, label: null },
          },
          onError: 'fail_open',
          endpoints: {
            include: ['*.example.com'],
            exclude: ['trusted.example.com'],
          },
        },
      },
    });
  });

  it('writes every field of the schema back', () => {
    const policy = read(EVERY_FIELD);
    for (const format of ['yaml', 'json'] as const) {
      const file = write(policy, format);
      expect(canonical(file)).toEqual(canonical(EVERY_FIELD));
      expect([...fieldsOf(parseYaml(file))].sort()).toEqual(
        [...SCHEMA_FIELDS].sort(),
      );
      expect(read(file)).toEqual(policy);
    }
  });

  // Every field of a type, required: the policy below has to set each one,
  // and a field the type gains does not compile until it is set here too. A
  // matcher is the exception, being one of two things and never both.
  type IsMatcher<T> = [keyof T] extends [keyof L7QueryMatcher]
    ? [keyof L7QueryMatcher] extends [keyof T]
      ? true
      : false
    : false;
  type Whole<T> =
    IsMatcher<T> extends true
      ? T
      : T extends readonly (infer U)[]
        ? Whole<U>[]
        : T extends object
          ? { [K in keyof T]-?: Whole<NonNullable<T[K]>> }
          : T;

  const WHOLE: Whole<SandboxPolicy> = {
    version: 1,
    filesystem: {
      includeWorkdir: true,
      readOnly: ['/usr'],
      readWrite: ['/tmp'],
    },
    landlock: { compatibility: 'hard_requirement' },
    process: { runAsUser: '1500', runAsGroup: 'sandbox' },
    networkPolicies: {
      everything: {
        name: 'Everything at once',
        endpoints: [
          {
            host: 'mcp.example.com',
            port: 443,
            ports: [443, 8443],
            protocol: 'mcp',
            tls: 'NETWORK_TLS_MODE_SKIP',
            enforcement: 'NETWORK_ENFORCEMENT_MODE_AUDIT',
            access: 'NETWORK_ACCESS_PRESET_FULL',
            rules: [
              {
                allow: {
                  method: 'tools/call',
                  path: '/v1/**',
                  command: 'SELECT',
                  query: {
                    tag: { glob: 'prod-*' },
                    env: { any: ['a-*', 'b-*'] },
                  },
                  operationType: 'query',
                  operationName: 'Get*',
                  fields: ['viewer'],
                  params: {
                    name: { glob: 'search_*' },
                    'arguments.repo': { any: ['NVIDIA/*', 'openai/*'] },
                  },
                },
              },
            ],
            denyRules: [
              {
                method: 'tools/call',
                path: '/v1/admin/**',
                command: 'DROP',
                query: { force: { glob: 'true' } },
                operationType: 'mutation',
                operationName: 'Delete*',
                fields: ['deleteRepository'],
                params: { name: { any: ['send_email'] } },
              },
            ],
            allowedIps: ['10.0.5.0/24'],
            path: '/mcp',
            advisorProposed: true,
            allowEncodedSlash: true,
            persistedQueries: 'allow_registered',
            graphqlPersistedQueries: {
              abc123: {
                operationType: 'query',
                operationName: 'Viewer',
                fields: ['viewer'],
              },
            },
            graphqlMaxBodyBytes: 131072,
            websocketCredentialRewrite: true,
            requestBodyCredentialRewrite: true,
            allowUninspectedCredentials: true,
            providerCredentialed: true,
            credentialSigning: 'sigv4',
            signingService: 'bedrock',
            signingRegion: 'us-east-1',
            jsonRpcMaxBodyBytes: 4096,
            mcp: {
              strictToolNames: false,
              allowAllKnownMcpMethods: false,
              versions: ['2025-03-26', '2025-11-25'],
            },
            credentialBinding: { provider: 'vault' },
          },
        ],
        binaries: [{ path: '/usr/bin/curl' }],
      },
    },
    networkMiddlewares: {
      redactor: {
        name: 'Redactor',
        middleware: 'openshell/regex',
        config: { mode: 'redact', nested: { list: [1, 'two', true, null] } },
        onError: 'fail_open',
        endpoints: { include: ['*.example.com'], exclude: ['b.example.com'] },
        order: 20,
      },
    },
  };

  it('writes and reads back a policy that sets every field its type has', () => {
    // The two marks only the gateway sets are the two things a file has no
    // field for. Everything else comes back as it went.
    const expected = JSON.parse(JSON.stringify(WHOLE)) as SandboxPolicy;
    const endpoint = expected.networkPolicies?.everything.endpoints?.[0];
    delete endpoint?.providerCredentialed;
    delete endpoint?.advisorProposed;

    for (const format of ['yaml', 'json'] as const) {
      const file = write(WHOLE, format);
      expect(file).not.toMatch(/provider_credentialed|advisor_proposed/);
      expect(read(file)).toEqual(expected);
      // And the same through the reader of any text.
      expect(readPolicyText(file).policy).toEqual(expected);
    }
    // A matcher of each kind was among them.
    const allow = endpoint?.rules?.[0].allow;
    expect(allow?.query?.tag).toEqual({ glob: 'prod-*' });
    expect(allow?.query?.env).toEqual({ any: ['a-*', 'b-*'] });
  });

  it('finds nothing unknown in a policy that sets every field', () => {
    expect(policyToDocument(WHOLE).diagnostics).toEqual([]);
  });
});

// --- What a file says differently from the API ---

describe('the filesystem, landlock and process sections', () => {
  // distinguishes_absent_and_empty_filesystem
  it('keeps a filesystem section that is there apart from one that is not', () => {
    expect(read('version: 1\n')).toEqual({ version: 1 });
    expect(read('version: 1\nfilesystem_policy: {}\n')).toEqual({
      version: 1,
      filesystem: {},
    });
    // And writes include_workdir whenever there is a section, as upstream
    // does: left out of a section it is false, and left out with the section
    // it is true.
    expect(parseYaml(write({ version: 1, filesystem: {} }))).toEqual({
      version: 1,
      filesystem_policy: { include_workdir: false },
    });
    expect(parseYaml(write({ version: 1 }))).toEqual({ version: 1 });
  });

  // serialized_yaml_uses_filesystem_policy_key, with the policy upstream
  // gives a sandbox that has none (restrictive_default_policy).
  it('writes the filesystem section under filesystem_policy', () => {
    const restrictive: SandboxPolicy = {
      version: 1,
      filesystem: {
        includeWorkdir: true,
        readOnly: [
          '/bin',
          '/usr',
          '/lib',
          '/proc',
          '/dev/urandom',
          '/etc',
          '/var/log',
        ],
        readWrite: ['/tmp', '/dev/null'],
      },
      landlock: { compatibility: 'best_effort' },
    };
    const yaml = write(restrictive);
    expect(yaml).toContain('filesystem_policy:');
    expect(yaml).not.toContain('\nfilesystem:');
    expect(read(yaml)).toEqual(restrictive);
  });

  // parse_accepts_known_landlock_compatibility
  it.each(['best_effort', 'hard_requirement'])(
    'reads landlock compatibility %s',
    (value) => {
      expect(
        read(`version: 1\nlandlock:\n  compatibility: ${value}\n`).landlock,
      ).toEqual({ compatibility: value });
    },
  );

  it('reads a landlock section that names no mode as best_effort', () => {
    expect(read('version: 1\nlandlock: {}\n').landlock).toEqual({
      compatibility: 'best_effort',
    });
  });

  // parse_rejects_invalid_landlock_compatibility
  it('refuses a landlock mode there is not, and says which there are', () => {
    expect(refusal('version: 1\nlandlock:\n  compatibility: bogus\n')).toBe(
      'failed to decode sandbox policy fields: landlock.compatibility: unknown variant `bogus`, expected `best_effort` or `hard_requirement`',
    );
  });

  // serialize_accepts_empty_landlock_compatibility: the empty string is the
  // API's default and means best_effort.
  it('writes a landlock section whose mode is not set as best_effort', () => {
    expect(parseYaml(write({ version: 1, landlock: {} }))).toEqual({
      version: 1,
      landlock: { compatibility: 'best_effort' },
    });
  });

  // serialize_rejects_invalid_landlock_compatibility: a policy stored before
  // the gateway checked this is not quietly turned into best_effort.
  it('does not write a landlock mode there is not', () => {
    expect(
      unwritable({
        version: 1,
        landlock: { compatibility: 'hard-requirement' },
      }),
    ).toBe(
      'landlock.compatibility: invalid landlock.compatibility "hard-requirement"; accepted: best_effort, hard_requirement',
    );
  });

  // canonical_serializers_preserve_independent_process_identity_omission
  it.each([
    ['', '', undefined, undefined],
    ['1500', '', '1500', undefined],
    ['', '1600', undefined, '1600'],
    ['1500', '1600', '1500', '1600'],
  ])(
    'writes a process section of user "%s" and group "%s" with only what is set',
    (user, group, expectedUser, expectedGroup) => {
      const policy: SandboxPolicy = {
        version: 1,
        process: { runAsUser: user, runAsGroup: group },
      };
      for (const format of ['yaml', 'json'] as const) {
        const doc = parseYaml(write(policy, format)) as {
          process?: { run_as_user?: string; run_as_group?: string };
        };
        expect(doc.process?.run_as_user).toBe(expectedUser);
        expect(doc.process?.run_as_group).toBe(expectedGroup);
        // A section that names neither is left out.
        expect(doc.process !== undefined).toBe(
          expectedUser !== undefined || expectedGroup !== undefined,
        );
        const again = read(write(policy, format)).process;
        expect(again?.runAsUser).toBe(expectedUser);
        expect(again?.runAsGroup).toBe(expectedGroup);
      }
    },
  );

  it('reads a process identity only as a string, as upstream does', () => {
    expect(
      read('version: 1\nprocess:\n  run_as_user: "1500"\n').process,
    ).toEqual({ runAsUser: '1500' });
    expect(refusal('version: 1\nprocess:\n  run_as_user: 1500\n')).toBe(
      'failed to decode sandbox policy fields: process.run_as_user: expected a string, found number 1500',
    );
  });
});

describe('the version', () => {
  // parse_minimal_policy_yaml
  it('reads the smallest policy there is', () => {
    expect(read('version: 1\n')).toEqual({ version: 1 });
  });

  // requires_version_one
  it('requires version 1', () => {
    expect(refusal('version: 2\n')).toBe(
      'unsupported policy version 2; expected version 1',
    );
    expect(refusal('network_policies: {}\n')).toBe(
      'failed to decode sandbox policy fields: missing field `version`',
    );
  });

  // canonical_serializers_materialize_omitted_proto_version: the API does
  // not say whether a number was set, so none is the one there is.
  it('writes a policy that has no version as version 1', () => {
    for (const policy of [{}, { version: 0 }]) {
      expect(read(write(policy)).version).toBe(1);
      expect(JSON.parse(write(policy, 'json')).version).toBe(1);
    }
  });

  // canonical_serializers_reject_unsupported_proto_version
  it('does not write a version a file cannot be', () => {
    expect(unwritable({ version: 2 })).toBe(
      'cannot serialize unsupported protobuf policy version 2; expected 0 (omitted) or 1',
    );
  });
});

describe('rule and middleware names', () => {
  // parse_policy_with_network_rules
  it('reads a rule with its endpoints and binaries', () => {
    const rule = read(
      'version: 1\nnetwork_policies:\n  test:\n    name: test_policy\n    endpoints:\n      - { host: example.com, port: 443 }\n    binaries:\n      - { path: /usr/bin/curl }\n',
    ).networkPolicies?.test;
    expect(rule).toEqual({
      name: 'test_policy',
      endpoints: [{ host: 'example.com', port: 443, ports: [443] }],
      binaries: [{ path: '/usr/bin/curl' }],
    });
  });

  // round_trip_preserves_policy_name
  it('keeps the name a rule gives itself', () => {
    const yaml =
      'version: 1\nnetwork_policies:\n  my_api:\n    name: my-custom-api-name\n    endpoints:\n      - host: api.example.com\n        port: 443\n    binaries:\n      - path: /usr/bin/curl\n';
    const policy = read(yaml);
    expect(policy.networkPolicies?.my_api.name).toBe('my-custom-api-name');
    expect(read(write(policy)).networkPolicies?.my_api.name).toBe(
      'my-custom-api-name',
    );
  });

  it('names a rule by its key when the file gives it no name', () => {
    const policy = read(
      'version: 1\nnetwork_policies:\n  my_api:\n    endpoints:\n      - { host: a.example, port: 443 }\n',
    );
    expect(policy.networkPolicies?.my_api.name).toBe('my_api');
    // Written with the name it now has, as upstream writes it.
    expect(write(policy)).toContain('name: my_api');
  });

  it('writes a rule the API holds without a name without one', () => {
    const yaml = write({
      version: 1,
      networkPolicies: {
        web: { endpoints: [{ host: 'a.example', port: 443 }] },
      },
    });
    expect(parseYaml(yaml)).toEqual({
      version: 1,
      network_policies: {
        web: { endpoints: [{ host: 'a.example', port: 443 }] },
      },
    });
  });

  it('writes rules in the order of their keys', () => {
    const yaml = write({
      version: 1,
      networkPolicies: { zeta: {}, alpha: {}, mid: {} },
    });
    expect(
      Object.keys(
        (parseYaml(yaml) as { network_policies: Doc }).network_policies,
      ),
    ).toEqual(['alpha', 'mid', 'zeta']);
  });

  // parse_rejects_removed_network_binary_harness_field
  it('reads a binary as its path and nothing else', () => {
    expect(
      refusal(
        'version: 1\nnetwork_policies:\n  legacy:\n    endpoints:\n      - host: example.com\n        port: 443\n    binaries:\n      - path: /usr/bin/curl\n        harness: true\n',
      ),
    ).toBe(
      "unknown field 'network_policies.legacy.binaries[0].harness' in authored policy",
    );
    // A policy file has no short form for a binary. A profile file does.
    expect(
      refusal(
        'version: 1\nnetwork_policies:\n  api:\n    binaries:\n      - /usr/bin/curl\n',
      ),
    ).toBe(
      'failed to decode sandbox policy fields: network_policies.api.binaries[0]: expected a mapping, found string "/usr/bin/curl"',
    );
    expect(
      refusal(
        'version: 1\nnetwork_policies:\n  api:\n    binaries:\n      - {}\n',
      ),
    ).toBe(
      'failed to decode sandbox policy fields: network_policies.api.binaries[0]: missing field `path`',
    );
  });
});

describe('ports', () => {
  // parse_ports_array
  it('reads ports as they are, and port as the first of them', () => {
    const endpoint = withEndpoint('        ports: [80, 443]\n');
    expect(endpoint.ports).toEqual([80, 443]);
    expect(endpoint.port).toBe(80);
  });

  // parse_single_port_normalized_to_ports
  it('reads port as the one entry of ports', () => {
    const endpoint = withEndpoint('        port: 443\n');
    expect(endpoint.ports).toEqual([443]);
    expect(endpoint.port).toBe(443);
  });

  it('takes ports over port when a file has both', () => {
    const endpoint = withEndpoint(
      '        port: 22\n        ports: [80, 443]\n',
    );
    expect(endpoint.ports).toEqual([80, 443]);
    expect(endpoint.port).toBe(80);
  });

  it('reads an endpoint that names no port as one that has none', () => {
    expect(withEndpoint('        protocol: rest\n')).toEqual({
      host: 'a.example',
      protocol: 'rest',
    });
  });

  // round_trip_preserves_multi_port
  it('writes several ports as ports', () => {
    const policy = read(
      `${ENDPOINT}        ports:\n          - 80\n          - 443\n`,
    );
    const written = endpointIn(write(policy));
    expect(written).toEqual({ host: 'a.example', ports: [80, 443] });
    expect(read(write(policy))).toEqual(policy);
  });

  // serialize_single_port_uses_compact_form
  it('writes one port as port', () => {
    const yaml = write(read(`${ENDPOINT}        port: 443\n`));
    expect(yaml).toContain('port: 443');
    expect(yaml).not.toContain('ports:');
    // Whichever of the two the API holds it in.
    for (const endpoint of [
      { host: 'a.example', port: 443 },
      { host: 'a.example', ports: [443] },
      { host: 'a.example', port: 443, ports: [443] },
      // `ports` is the one that counts when the two disagree.
      { host: 'a.example', port: 22, ports: [443] },
    ]) {
      expect(endpointIn(write(policyOf(endpoint)))).toEqual({
        host: 'a.example',
        port: 443,
      });
    }
  });

  // rejects_oversized_port and rejects_port_above_65535
  it.each([65536, 70000, -1, '"443"', 4.5])('refuses %s for a port', (port) => {
    expect(refusal(`${ENDPOINT}        port: ${port}\n`)).toMatch(
      /^failed to decode sandbox policy fields: network_policies\.api\.endpoints\[0\]\.port: expected a port number from 0 to 65535, found /,
    );
    expect(refusal(`${ENDPOINT}        ports: [80, ${port}]\n`)).toContain(
      'network_policies.api.endpoints[0].ports[1]: expected a port number',
    );
  });

  it('reads a port written with a fraction of nothing, as upstream does', () => {
    expect(withEndpoint('        port: 443.0\n').port).toBe(443);
  });

  // serialization_rejects_proto_port_above_u16: the API's ports are wider
  // than a file's, and one that does not fit is not cut down to fit.
  it('does not write a port a file cannot hold', () => {
    expect(
      unwritable({
        version: 1,
        networkPolicies: {
          'too-wide': { endpoints: [{ host: 'example.com', port: 65536 }] },
        },
      }),
    ).toBe(
      "networkPolicies.too-wide.endpoints[0]: cannot serialize endpoint 'example.com': port 65536 exceeds 65535",
    );
    expect(
      unwritable(policyOf({ host: 'example.com', ports: [443, 70000] })),
    ).toContain('port 70000 exceeds 65535');
  });
});

describe('endpoint modes', () => {
  it('reads tls, enforcement and access as the values the API has for them', () => {
    expect(
      withEndpoint(
        '        tls: skip\n        enforcement: audit\n        access: read-write\n',
      ),
    ).toEqual({
      host: 'a.example',
      tls: 'NETWORK_TLS_MODE_SKIP',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_AUDIT',
      access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
    });
    expect(
      withEndpoint('        enforcement: enforce\n        access: full\n'),
    ).toEqual({
      host: 'a.example',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      access: 'NETWORK_ACCESS_PRESET_FULL',
    });
    expect(withEndpoint('        access: read-only\n').access).toBe(
      'NETWORK_ACCESS_PRESET_READ_ONLY',
    );
  });

  it('reads a mode that is not named, or named nothing, as not set', () => {
    expect(
      withEndpoint(
        '        tls: ""\n        enforcement: ""\n        access: ""\n',
      ),
    ).toEqual({ host: 'a.example' });
  });

  // endpoint_modes_accept_documented_values_and_defaults
  it('writes every mode back by the name a file has for it', () => {
    for (const tls of ['', 'skip']) {
      for (const enforcement of ['', 'enforce', 'audit']) {
        for (const access of ['', 'read-only', 'read-write', 'full']) {
          const yaml = `${ENDPOINT}        tls: "${tls}"\n        enforcement: "${enforcement}"\n        access: "${access}"\n`;
          const written = endpointIn(write(read(yaml)));
          expect(written.tls ?? '').toBe(tls);
          expect(written.enforcement ?? '').toBe(enforcement);
          expect(written.access ?? '').toBe(access);
        }
      }
    }
  });

  it('writes a mode the API gives by number, or as unspecified, the same', () => {
    expect(
      endpointIn(
        write(
          policyOf({
            host: 'a.example',
            tls: 1 as unknown as string,
            enforcement: 2 as unknown as string,
            access: 'NETWORK_ACCESS_PRESET_UNSPECIFIED',
          }),
        ),
      ),
    ).toEqual({ host: 'a.example', tls: 'skip', enforcement: 'audit' });
  });

  // validation_rejects_unknown_security_sensitive_endpoint_values and
  // endpoint_modes_reject_unknown_values: a name that is not one is not sent
  // on as nothing, which would be the default.
  it('refuses a mode it does not know, each by name and where it is', () => {
    const parsed = parsePolicyFile(
      'version: 1\nnetwork_policies:\n  github_api:\n    endpoints:\n      - host: api.github.com\n        port: 443\n        protocol: rest\n        tls: skp\n        enforcement: enforc\n        access: read-wirte\n',
    );
    expect(parsed.policy).toBeUndefined();
    expect(parsed.diagnostics).toEqual([
      {
        path: 'network_policies.github_api.endpoints[0].tls',
        message:
          "network policy 'github_api': endpoint 0: unknown tls value 'skp'; omit the field to keep automatic TLS termination",
      },
      {
        path: 'network_policies.github_api.endpoints[0].enforcement',
        message:
          "network policy 'github_api': endpoint 0: unknown enforcement value 'enforc' (expected enforce or audit)",
      },
      {
        path: 'network_policies.github_api.endpoints[0].access',
        message:
          "network policy 'github_api': endpoint 0: unknown access value 'read-wirte' (expected read-only, read-write, or full)",
      },
    ]);
  });

  // endpoint_mode_values_reject_removed_tls_enums: the enum still has them
  // and no policy may use them.
  it.each(['terminate', 'passthrough'])(
    'refuses tls %s, which upstream has removed, in a file and from the API',
    (tls) => {
      expect(refusal(`${ENDPOINT}        tls: ${tls}\n`)).toBe(
        `network policy 'api': endpoint 0: unknown tls value '${tls}'; omit the field to keep automatic TLS termination`,
      );
      expect(
        unwritable(
          policyOf({
            host: 'a.example',
            tls: `NETWORK_TLS_MODE_${tls.toUpperCase()}`,
          }),
        ),
      ).toBe(
        `network policy 'api': endpoint 0: unknown tls value '${tls}'; omit the field to keep automatic TLS termination`,
      );
    },
  );

  it('does not write a mode the API gives that it has no name for', () => {
    expect(
      unwritable(
        policyOf({ host: 'a.example', enforcement: 99 as unknown as string }),
      ),
    ).toBe(
      "network policy 'api': endpoint 0: unknown enforcement enum value 99",
    );
    expect(
      unwritable(policyOf({ host: 'a.example', tls: 7 as unknown as string })),
    ).toBe("network policy 'api': endpoint 0: unknown tls enum value 7");
    // A file's own name is not the API's.
    expect(unwritable(policyOf({ host: 'a.example', access: 'full' }))).toBe(
      "network policy 'api': endpoint 0: unknown access enum value full",
    );
  });

  it('refuses a mode in any case but its own', () => {
    expect(refusal(`${ENDPOINT}        tls: SKIP\n`)).toContain(
      "unknown tls value 'SKIP'",
    );
  });
});

describe('endpoint fields', () => {
  // round_trip_preserves_allowed_ips
  it('keeps allowed_ips', () => {
    const policy = read(
      'version: 1\nnetwork_policies:\n  internal:\n    name: internal\n    endpoints:\n      - host: db.internal.corp\n        port: 5432\n        allowed_ips:\n          - "10.0.5.0/24"\n          - "10.0.6.0/24"\n    binaries:\n      - path: /usr/bin/curl\n',
    );
    const ips = ['10.0.5.0/24', '10.0.6.0/24'];
    expect(policy.networkPolicies?.internal.endpoints?.[0].allowedIps).toEqual(
      ips,
    );
    expect(
      read(write(policy)).networkPolicies?.internal.endpoints?.[0].allowedIps,
    ).toEqual(ips);
  });

  // parse_wildcard_host and round_trip_preserves_wildcard_host
  it('keeps a wildcard host', () => {
    const policy = read(`version: 1
network_policies:
  test:
    endpoints:
      - { host: "*.example.com", port: 443 }
`);
    expect(policy.networkPolicies?.test.endpoints?.[0].host).toBe(
      '*.example.com',
    );
    expect(read(write(policy))).toEqual(policy);
  });

  // round_trip_preserves_endpoint_path
  it('keeps the path that scopes an endpoint', () => {
    const policy = read(
      `${ENDPOINT}        port: 443\n        path: "/graphql"\n        protocol: graphql\n        rules:\n          - allow:\n              operation_type: query\n`,
    );
    expect(policy.networkPolicies?.api.endpoints?.[0].path).toBe('/graphql');
    expect(read(write(policy))).toEqual(policy);
  });

  // round_trip_preserves_endpoint_credential_binding
  it('keeps a credential binding', () => {
    const policy = read(`version: 1
network_policies:
  gcp_storage:
    endpoints:
      - host: storage.googleapis.com
        port: 443
        protocol: rest
        credential_binding:
          provider: work-gcp
`);
    expect(
      policy.networkPolicies?.gcp_storage.endpoints?.[0].credentialBinding,
    ).toEqual({ provider: 'work-gcp' });
    const yaml = write(policy);
    expect(yaml).toContain('credential_binding:');
    expect(yaml).toContain('provider: work-gcp');
    expect(read(yaml)).toEqual(policy);
  });

  it('requires a credential binding to name its provider', () => {
    expect(refusal(`${ENDPOINT}        credential_binding: {}\n`)).toBe(
      'failed to decode sandbox policy fields: network_policies.api.endpoints[0].credential_binding: missing field `provider`',
    );
  });

  // round_trip_preserves_websocket_credential_rewrite,
  // round_trip_preserves_request_body_credential_rewrite and
  // round_trip_preserves_allow_uninspected_credentials
  it.each([
    ['websocket_credential_rewrite', 'websocketCredentialRewrite'],
    ['request_body_credential_rewrite', 'requestBodyCredentialRewrite'],
    ['allow_uninspected_credentials', 'allowUninspectedCredentials'],
    ['allow_encoded_slash', 'allowEncodedSlash'],
  ] as const)('keeps %s', (key, field) => {
    const policy = read(`${ENDPOINT}        port: 443\n        ${key}: true\n`);
    expect(policy.networkPolicies?.api.endpoints?.[0][field]).toBe(true);
    const yaml = write(policy);
    expect(yaml).toContain(`${key}: true`);
    expect(read(yaml)).toEqual(policy);
  });

  // websocket_credential_rewrite_defaults_false
  it('leaves what a file does not turn on off, and does not write it', () => {
    const endpoint = withEndpoint(
      '        port: 443\n        protocol: rest\n        access: full\n        allow_encoded_slash: false\n',
    );
    expect(endpoint).toEqual({
      host: 'a.example',
      port: 443,
      ports: [443],
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_FULL',
    });
    expect(endpointIn(write(policyOf(endpoint)))).toEqual({
      host: 'a.example',
      port: 443,
      protocol: 'rest',
      access: 'full',
    });
  });

  // round_trip_preserves_allow_uninspected_credentials, its other half:
  // which endpoints belong to a provider is the gateway's to say.
  it("has no field for the gateway's own marks, in either direction", () => {
    for (const mark of ['provider_credentialed', 'advisor_proposed']) {
      expect(refusal(`${ENDPOINT}        ${mark}: true\n`)).toBe(
        `unknown field 'network_policies.api.endpoints[0].${mark}' in authored policy`,
      );
    }
    const yaml = write(
      policyOf({
        host: 'a.example',
        port: 443,
        providerCredentialed: true,
        advisorProposed: true,
      }),
    );
    expect(endpointIn(yaml)).toEqual({ host: 'a.example', port: 443 });
  });

  // round_trip_preserves_graphql_policy_fields
  it('keeps the GraphQL fields of an endpoint and of its rules', () => {
    const policy = read(`version: 1
network_policies:
  github_graphql:
    name: github_graphql
    endpoints:
      - host: api.github.com
        port: 443
        protocol: graphql
        enforcement: enforce
        persisted_queries: allow_registered
        graphql_max_body_bytes: 131072
        graphql_persisted_queries:
          abc123:
            operation_type: query
            operation_name: Viewer
            fields: [viewer]
        rules:
          - allow:
              operation_type: query
              fields: [viewer, repository]
          - allow:
              operation_type: mutation
              operation_name: Issue*
              fields: [createIssue]
        deny_rules:
          - operation_type: mutation
            fields: [deleteRepository]
    binaries:
      - path: /usr/bin/curl
`);
    expect(policy.networkPolicies?.github_graphql.endpoints?.[0]).toEqual({
      host: 'api.github.com',
      port: 443,
      ports: [443],
      protocol: 'graphql',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      persistedQueries: 'allow_registered',
      graphqlMaxBodyBytes: 131072,
      graphqlPersistedQueries: {
        abc123: {
          operationType: 'query',
          operationName: 'Viewer',
          fields: ['viewer'],
        },
      },
      rules: [
        { allow: { operationType: 'query', fields: ['viewer', 'repository'] } },
        {
          allow: {
            operationType: 'mutation',
            operationName: 'Issue*',
            fields: ['createIssue'],
          },
        },
      ],
      denyRules: [{ operationType: 'mutation', fields: ['deleteRepository'] }],
    });
    expect(read(write(policy))).toEqual(policy);
  });
});

describe('allow and deny rules', () => {
  // parse_deny_rules_from_yaml and round_trip_preserves_deny_rules
  it('reads deny rules bare, and allow rules under allow', () => {
    const policy = read(`version: 1
network_policies:
  github:
    name: github
    endpoints:
      - host: api.github.com
        port: 443
        protocol: rest
        access: full
        rules:
          - allow:
              method: GET
              path: "/repos/**"
        deny_rules:
          - method: POST
            path: "/repos/*/pulls/*/reviews"
          - method: DELETE
            path: "/repos/*/branches/*/protection"
            query:
              force: "true"
`);
    const endpoint = policy.networkPolicies?.github.endpoints?.[0];
    expect(endpoint?.rules).toEqual([
      { allow: { method: 'GET', path: '/repos/**' } },
    ]);
    expect(endpoint?.denyRules).toEqual([
      { method: 'POST', path: '/repos/*/pulls/*/reviews' },
      {
        method: 'DELETE',
        path: '/repos/*/branches/*/protection',
        query: { force: { glob: 'true' } },
      },
    ]);
    expect(read(write(policy))).toEqual(policy);
  });

  it('requires a rule to say what it allows, even if that is nothing', () => {
    expect(
      withEndpoint('        rules:\n          - allow: {}\n').rules,
    ).toEqual([{ allow: {} }]);
    expect(refusal(`${ENDPOINT}        rules:\n          - {}\n`)).toBe(
      'failed to decode sandbox policy fields: network_policies.api.endpoints[0].rules[0]: missing field `allow`',
    );
    // A rule the API holds without an `allow` is written with an empty one.
    expect(
      endpointIn(write(policyOf({ host: 'a.example', rules: [{}] }))).rules,
    ).toEqual([{ allow: {} }]);
  });

  // parse_l7_query_matchers_and_round_trip
  it('reads a matcher written bare as its glob, and one under any as its list', () => {
    const policy = read(
      `${ENDPOINT}        port: 8080\n        protocol: rest\n        rules:\n          - allow:\n              method: GET\n              path: /download\n              query:\n                slug: "my-*"\n                tag:\n                  any: ["foo-*", "bar-*"]\n`,
    );
    const allow = policy.networkPolicies?.api.endpoints?.[0].rules?.[0].allow;
    expect(allow?.query).toEqual({
      slug: { glob: 'my-*' },
      tag: { any: ['foo-*', 'bar-*'] },
    });
    const written = endpointIn(write(policy)) as {
      rules: { allow: { query: Doc } }[];
    };
    expect(written.rules[0].allow.query).toEqual({
      slug: 'my-*',
      tag: { any: ['foo-*', 'bar-*'] },
    });
    expect(read(write(policy))).toEqual(policy);
  });

  // parse_deny_rules_with_query_any
  it('reads the matchers of a deny rule the same way', () => {
    expect(
      withEndpoint(
        '        deny_rules:\n          - method: POST\n            path: /action\n            query:\n              type:\n                any: ["admin-*", "root-*"]\n',
      ).denyRules?.[0].query,
    ).toEqual({ type: { any: ['admin-*', 'root-*'] } });
  });

  it.each(['1', 'true', 'null', '[a, b]'])(
    'refuses %s for a matcher, which is a string or a list under any',
    (value) => {
      expect(
        refusal(
          `${ENDPOINT}        rules:\n          - allow:\n              query:\n                page: ${value}\n`,
        ),
      ).toMatch(
        /^failed to decode sandbox policy fields: network_policies\.api\.endpoints\[0\]\.rules\[0\]\.allow\.query\.page: expected a glob or `\{ any: \[globs\] \}`, found /,
      );
    },
  );

  it('writes a matcher that matches nothing in particular as an empty glob', () => {
    const written = endpointIn(
      write(
        policyOf({
          host: 'a.example',
          rules: [{ allow: { query: { q: {} } } }],
        }),
      ),
    ) as { rules: { allow: { query: Doc } }[] };
    expect(written.rules[0].allow.query).toEqual({ q: '' });
  });

  // Upstream writes the list and drops the glob. A file cannot say both, and
  // the gateway refuses a matcher that does; here it is said, not dropped.
  it('does not write a matcher that sets both a glob and a list', () => {
    expect(
      unwritable(
        policyOf({
          host: 'a.example',
          rules: [{ allow: { query: { q: { glob: 'a-*', any: ['b-*'] } } } }],
        }),
      ),
    ).toBe(
      'networkPolicies.api.endpoints[0].rules[0].allow.query.q: a matcher that sets both `glob` and `any` cannot be written to a policy file, which has one or the other',
    );
  });

  it('writes the matchers of a rule in the order of their names', () => {
    const written = endpointIn(
      write(
        policyOf({
          host: 'a.example',
          rules: [
            {
              allow: {
                query: { zeta: { glob: 'z' }, alpha: { glob: 'a' } },
              },
            },
          ],
        }),
      ),
    ) as { rules: { allow: { query: Doc } }[] };
    expect(Object.keys(written.rules[0].allow.query)).toEqual([
      'alpha',
      'zeta',
    ]);
  });
});

describe('JSON-RPC and MCP', () => {
  const MCP = `${ENDPOINT}        port: 443\n        protocol: mcp\n`;

  // round_trip_preserves_json_rpc_max_body_bytes
  it('reads json_rpc.max_body_bytes as the one body limit the API has', () => {
    const policy = read(
      `${ENDPOINT}        port: 443\n        protocol: json-rpc\n        enforcement: enforce\n        json_rpc:\n          max_body_bytes: 131072\n        rules:\n          - allow:\n              method: initialize\n`,
    );
    const endpoint = policy.networkPolicies?.api.endpoints?.[0];
    expect(endpoint?.jsonRpcMaxBodyBytes).toBe(131072);
    expect(endpoint).not.toHaveProperty('mcp');
    expect(endpointIn(write(policy)).json_rpc).toEqual({
      max_body_bytes: 131072,
    });
    expect(read(write(policy))).toEqual(policy);
  });

  it('takes the MCP mapping for the limit whenever there is one', () => {
    expect(
      withEndpoint(
        '        protocol: mcp\n        json_rpc:\n          max_body_bytes: 1\n        mcp:\n          max_body_bytes: 2\n',
      ).jsonRpcMaxBodyBytes,
    ).toBe(2);
    // Even one that sets no limit.
    expect(
      withEndpoint(
        '        protocol: mcp\n        json_rpc:\n          max_body_bytes: 1\n        mcp: {}\n',
      ),
    ).not.toHaveProperty('jsonRpcMaxBodyBytes');
    expect(
      withEndpoint(
        '        protocol: mcp\n        json_rpc:\n          max_body_bytes: 1\n',
      ).jsonRpcMaxBodyBytes,
    ).toBe(1);
  });

  it('writes the limit under mcp on an MCP endpoint and json_rpc on any other', () => {
    expect(
      endpointIn(
        write(
          policyOf({
            host: 'a.example',
            protocol: 'MCP',
            jsonRpcMaxBodyBytes: 4096,
          }),
        ),
      ),
    ).toEqual({
      host: 'a.example',
      protocol: 'MCP',
      mcp: { versions: [DEFAULT_MCP_VERSION], max_body_bytes: 4096 },
    });
    expect(
      endpointIn(
        write(policyOf({ host: 'a.example', jsonRpcMaxBodyBytes: 4096 })),
      ),
    ).toEqual({ host: 'a.example', json_rpc: { max_body_bytes: 4096 } });
  });

  // parse_rejects_unsupported_json_rpc_config_fields
  it('refuses a field json_rpc does not have', () => {
    expect(
      refusal(
        `${ENDPOINT}        protocol: json-rpc\n        json_rpc:\n          max_body_bytes: 131072\n          on_parse_error: deny\n          batch_policy: all\n        access: full\n`,
      ),
    ).toBe(
      [
        "unknown field 'network_policies.api.endpoints[0].json_rpc.on_parse_error' in authored policy",
        "unknown field 'network_policies.api.endpoints[0].json_rpc.batch_policy' in authored policy",
      ].join('\n'),
    );
  });

  // parse_mcp_rules_to_runtime_fields
  it('reads the rules and options of an MCP endpoint as the API holds them', () => {
    const policy = read(`version: 1
network_policies:
  mcp:
    name: mcp
    endpoints:
      - host: mcp.example.com
        port: 443
        path: /mcp
        protocol: mcp
        enforcement: enforce
        mcp:
          versions: [2025-03-26]
          max_body_bytes: 131072
          strict_tool_names: false
        rules:
          - allow:
              method: initialize
          - allow:
              method: tools/list
          - allow:
              method: tools/call
              tool:
                any: [search_web, list_tools]
        deny_rules:
          - method: tools/call
            tool: send_email
    binaries:
      - path: /usr/bin/curl
`);
    expect(policy.networkPolicies?.mcp.endpoints?.[0]).toEqual({
      host: 'mcp.example.com',
      port: 443,
      ports: [443],
      path: '/mcp',
      protocol: 'mcp',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      jsonRpcMaxBodyBytes: 131072,
      mcp: { strictToolNames: false, versions: ['2025-03-26'] },
      rules: [
        { allow: { method: 'initialize' } },
        { allow: { method: 'tools/list' } },
        {
          allow: {
            method: 'tools/call',
            params: { name: { any: ['search_web', 'list_tools'] } },
          },
        },
      ],
      denyRules: [
        { method: 'tools/call', params: { name: { glob: 'send_email' } } },
      ],
    });
  });

  // round_trip_mcp_policy_serializes_mcp_expression
  it('writes params.name on an MCP endpoint as tool', () => {
    const policy = read(
      `${MCP}        mcp:\n          versions: [2025-03-26]\n          max_body_bytes: 131072\n          strict_tool_names: false\n        rules:\n          - allow:\n              method: tools/call\n              tool: search_web\n        deny_rules:\n          - method: tools/call\n            tool:\n              any: [send_email, delete_resource]\n`,
    );
    const yaml = write(policy);
    expect(endpointIn(yaml)).toEqual({
      host: 'a.example',
      port: 443,
      protocol: 'mcp',
      rules: [{ allow: { method: 'tools/call', tool: 'search_web' } }],
      deny_rules: [
        {
          method: 'tools/call',
          tool: { any: ['send_email', 'delete_resource'] },
        },
      ],
      mcp: {
        versions: ['2025-03-26'],
        max_body_bytes: 131072,
        strict_tool_names: false,
      },
    });
    expect(yaml).not.toContain('arguments:');
    expect(read(yaml)).toEqual(policy);
  });

  it('keeps params.name where it is on an endpoint that is not MCP', () => {
    const endpoint: NetworkEndpoint = {
      host: 'a.example',
      protocol: 'json-rpc',
      rules: [
        {
          allow: {
            method: 'call',
            params: { name: { glob: 'x' }, 'a.b': { glob: 'y' } },
          },
        },
      ],
    };
    const yaml = write(policyOf(endpoint));
    // Neither a tool nor nested: only MCP has those.
    expect(endpointIn(yaml).rules).toEqual([
      { allow: { method: 'call', params: { 'a.b': 'y', name: 'x' } } },
    ]);
    expect(read(yaml).networkPolicies?.api.endpoints?.[0]).toEqual(endpoint);
  });

  it('reads params.name over tool when a rule has both', () => {
    expect(
      withEndpoint(
        '        protocol: mcp\n        rules:\n          - allow:\n              tool: from_tool\n              params:\n                name: from_params\n',
      ).rules?.[0].allow?.params,
    ).toEqual({ name: { glob: 'from_params' } });
  });

  it('refuses a tool that is not a matcher, used or not', () => {
    expect(
      refusal(
        `${MCP}        rules:\n          - allow:\n              tool: 7\n              params:\n                name: x\n`,
      ),
    ).toContain('rules[0].allow.tool: expected a glob or `{ any: [globs] }`');
    expect(
      refusal(
        `${MCP}        rules:\n          - allow:\n              tool: null\n`,
      ),
    ).toContain('rules[0].allow.tool: expected a glob');
  });

  // accepts_open_user_data_maps and the nested half of
  // round_trip_preserves_any_as_an_mcp_parameter_name
  it('reads nested params under dotted keys, and writes them nested again', () => {
    const policy = read(
      `${MCP}        mcp: {}\n        rules:\n          - allow:\n              method: tools/call\n              query:\n                arbitrary_name: { any: ["one", "two"] }\n              params:\n                arguments:\n                  nested:\n                    leaf: "value-*"\n                  other: { any: [a, b] }\n`,
    );
    const allow = policy.networkPolicies?.api.endpoints?.[0].rules?.[0].allow;
    expect(allow?.params).toEqual({
      'arguments.nested.leaf': { glob: 'value-*' },
      'arguments.other': { any: ['a', 'b'] },
    });
    const written = endpointIn(write(policy)) as {
      rules: { allow: Doc }[];
    };
    expect(written.rules[0].allow.params).toEqual({
      arguments: { nested: { leaf: 'value-*' }, other: { any: ['a', 'b'] } },
    });
    expect(read(write(policy))).toEqual(policy);
  });

  // accepts_any_as_an_open_mcp_parameter_name and
  // round_trip_preserves_any_as_an_mcp_parameter_name: `any` beside another
  // name, or holding a string, is a parameter called any.
  it('reads any as the name of a parameter where it cannot be a matcher', () => {
    const policy = read(
      `${MCP}        mcp: {}\n        rules:\n          - allow:\n              method: tools/call\n              params:\n                arguments:\n                  any: "first"\n                  other: "second"\n`,
    );
    const params =
      policy.networkPolicies?.api.endpoints?.[0].rules?.[0].allow?.params;
    expect(params).toEqual({
      'arguments.any': { glob: 'first' },
      'arguments.other': { glob: 'second' },
    });
    const yaml = write(policy);
    expect(
      (endpointIn(yaml) as { rules: { allow: Doc }[] }).rules[0].allow.params,
    ).toEqual({ arguments: { any: 'first', other: 'second' } });
    expect(read(yaml)).toEqual(policy);
  });

  it('writes params flat when one key is the start of another', () => {
    const endpoint: NetworkEndpoint = {
      host: 'a.example',
      protocol: 'mcp',
      mcp: { versions: [DEFAULT_MCP_VERSION] },
      rules: [
        {
          allow: {
            method: 'tools/call',
            params: { a: { glob: 'x' }, 'a.b': { glob: 'y' } },
          },
        },
      ],
    };
    const yaml = write(policyOf(endpoint));
    expect(
      (endpointIn(yaml) as { rules: { allow: Doc }[] }).rules[0].allow.params,
    ).toEqual({ a: 'x', 'a.b': 'y' });
    expect(read(yaml).networkPolicies?.api.endpoints?.[0]).toEqual(endpoint);
  });

  // Every way a few dotted keys can share their starts, with a matcher of
  // each kind: what is written, nested or flat, reads back to the same keys.
  it('reads back the params it writes, however their keys overlap', () => {
    const names = ['a', 'a.b', 'a.b.c', 'a.any', 'b', 'b.any.c', 'c..d', 'any'];
    const matchers: L7QueryMatcher[] = [
      { glob: 'g-*' },
      { any: ['x', 'y'] },
      {},
    ];
    for (let mask = 1; mask < 1 << names.length; mask += 1) {
      const params = Object.fromEntries(
        names
          .filter((_, index) => mask & (1 << index))
          .map((name, index) => [name, matchers[(mask + index) % 3]]),
      );
      const endpoint: NetworkEndpoint = {
        host: 'a.example',
        protocol: 'mcp',
        mcp: { versions: [DEFAULT_MCP_VERSION] },
        denyRules: [{ method: 'tools/list', params }],
      };
      expect(
        read(write(policyOf(endpoint))).networkPolicies?.api.endpoints?.[0]
          .denyRules?.[0].params,
      ).toEqual(params);
    }
  });

  it('refuses a param that is neither a matcher nor a mapping of more', () => {
    expect(
      refusal(
        `${MCP}        rules:\n          - allow:\n              params:\n                arguments:\n                  depth: 3\n`,
      ),
    ).toBe(
      'failed to decode sandbox policy fields: network_policies.api.endpoints[0].rules[0].allow.params.arguments.depth: expected a glob, `{ any: [globs] }` or a mapping of nested parameters, found number 3',
    );
  });

  // What upstream reads an absent method as, it does not write: `*` on a
  // rule without a tool, and tools/call on a rule with one when the endpoint
  // allows every known method.
  it('leaves out the method of an MCP rule where its absence means the same', () => {
    const rulesOf = (endpoint: NetworkEndpoint) =>
      (endpointIn(write(policyOf(endpoint))) as { rules: { allow: Doc }[] })
        .rules;
    const mcp = (allowAll: boolean, rule: NetworkEndpoint['rules']) => ({
      host: 'a.example',
      protocol: 'mcp',
      mcp: { allowAllKnownMcpMethods: allowAll },
      rules: rule,
    });
    const any = [{ allow: { method: '*' } }];
    const tool = [
      { allow: { method: 'tools/call', params: { name: { glob: 't' } } } },
    ];
    expect(rulesOf(mcp(true, any))).toEqual([{ allow: {} }]);
    expect(rulesOf(mcp(false, any))).toEqual([{ allow: {} }]);
    expect(rulesOf(mcp(true, tool))).toEqual([{ allow: { tool: 't' } }]);
    expect(rulesOf(mcp(false, tool))).toEqual([
      { allow: { method: 'tools/call', tool: 't' } },
    ]);
    // Not on any other protocol.
    expect(
      rulesOf({ host: 'a.example', protocol: 'json-rpc', rules: any }),
    ).toEqual([{ allow: { method: '*' } }]);
  });

  // omitted_authored_mcp_versions_materialize_the_pinned_default
  it('gives an MCP endpoint that lists no revisions the pinned default', () => {
    const omitted = read(MCP);
    expect(omitted).toEqual(
      read(`${MCP}        mcp:\n          versions: ["2025-11-25"]\n`),
    );
    expect(omitted.networkPolicies?.api.endpoints?.[0].mcp).toEqual({
      versions: ['2025-11-25'],
    });
    expect(
      withEndpoint(
        '        protocol: mcp\n        mcp:\n          strict_tool_names: false\n',
      ).mcp,
    ).toEqual({ strictToolNames: false, versions: ['2025-11-25'] });
    const yaml = write(omitted);
    expect(yaml).toContain('versions:');
    expect(yaml).toContain(DEFAULT_MCP_VERSION);
  });

  it('gives no MCP options to an endpoint that is not MCP', () => {
    expect(withEndpoint('        protocol: rest\n')).not.toHaveProperty('mcp');
  });

  it('knows an MCP endpoint by its protocol in any case', () => {
    expect(withEndpoint('        protocol: MCP\n').mcp).toEqual({
      versions: [DEFAULT_MCP_VERSION],
    });
  });

  it('keeps an option that is turned off apart from one that is not set', () => {
    const policy = read(
      `${MCP}        mcp:\n          strict_tool_names: false\n          allow_all_known_mcp_methods: false\n`,
    );
    expect(policy.networkPolicies?.api.endpoints?.[0].mcp).toEqual({
      strictToolNames: false,
      allowAllKnownMcpMethods: false,
      versions: [DEFAULT_MCP_VERSION],
    });
    expect(endpointIn(write(policy)).mcp).toEqual({
      versions: [DEFAULT_MCP_VERSION],
      strict_tool_names: false,
      allow_all_known_mcp_methods: false,
    });
    expect(endpointIn(write(read(MCP))).mcp).toEqual({
      versions: [DEFAULT_MCP_VERSION],
    });
  });

  // mcp_version_yaml_rejects_explicit_empty_duplicate_unknown_and_misplaced_values
  it.each([
    ['a null list', 'mcp', 'versions: null', 'expected a list, found null'],
    [
      'an empty list',
      'mcp',
      'versions: []',
      "network policy 'api' has an empty mcp.versions list; omit it to use the pinned default revision",
    ],
    ['an empty revision', 'mcp', 'versions: [""]', "version ''"],
    [
      'a revision twice',
      'mcp',
      'versions: ["2025-03-26", "2025-03-26"]',
      "network policy 'api' has duplicate protocol version '2025-03-26'",
    ],
    [
      'a revision there is not',
      'mcp',
      'versions: ["2025-03-27"]',
      "network policy 'api': unsupported MCP protocol version '2025-03-27'",
    ],
    ['an alias', 'mcp', 'versions: ["latest"]', "version 'latest'"],
    ['the draft', 'mcp', 'versions: ["draft"]', "version 'draft'"],
    [
      'space before a revision',
      'mcp',
      'versions: [" 2025-03-26"]',
      "version ' 2025-03-26'",
    ],
    [
      'space after a revision',
      'mcp',
      'versions: ["2025-03-26 "]',
      "version '2025-03-26 '",
    ],
    [
      'revisions on an endpoint that is not MCP',
      'json-rpc',
      'versions: ["2025-03-26"]',
      "network policy 'api': non-MCP endpoint 'a.example' cannot configure mcp options",
    ],
  ])('refuses %s', (_case, protocol, body, message) => {
    expect(
      refusal(
        `${ENDPOINT}        port: 443\n        protocol: ${protocol}\n        mcp:\n          ${body}\n`,
      ),
    ).toContain(message);
  });

  it('refuses an mcp mapping that is null, and one on an endpoint with no protocol', () => {
    expect(refusal(`${MCP}        mcp: null\n`)).toBe(
      'failed to decode sandbox policy fields: network_policies.api.endpoints[0].mcp: expected a mapping, found null',
    );
    expect(refusal(`${ENDPOINT}        mcp: {}\n`)).toBe(
      "network policy 'api': non-MCP endpoint 'a.example' cannot configure mcp options",
    );
  });

  it('names a rule by its own name in what it says about its MCP options', () => {
    expect(
      refusal(
        'version: 1\nnetwork_policies:\n  key:\n    name: Named\n    endpoints:\n      - host: h\n        protocol: mcp\n        mcp:\n          versions: []\n',
      ),
    ).toBe(
      "network policy 'Named' has an empty mcp.versions list; omit it to use the pinned default revision",
    );
  });

  // unsupported_mcp_version_errors_explain_the_explicit_l4_escape_hatch
  it('says what to do about a revision it does not have', () => {
    const message = refusal(
      `${MCP}        mcp:\n          versions: ["draft"]\n`,
    );
    expect(message).toContain(
      'omit mcp.versions to use the pinned default revision',
    );
    expect(message).toContain(
      'omit protocol and mcp for deliberate uninspected L4 passthrough',
    );
    expect(
      unwritable(
        policyOf({
          host: 'mcp.example.com',
          protocol: 'mcp',
          mcp: { versions: ['2026-07-28'] },
        }),
      ),
    ).toBe(
      "cannot serialize invalid sandbox policy: sandbox policy validation failed; network policy 'api': MCP endpoint 'mcp.example.com' has unsupported protocol version '2026-07-28'; omit mcp.versions to use the pinned default revision, use an exact supported revision, or omit protocol and mcp for deliberate uninspected L4 passthrough only when that weaker boundary is acceptable",
    );
  });

  // protobuf_missing_and_empty_mcp_options_materialize_the_same_default
  it('writes an MCP endpoint the API holds without revisions with the default one', () => {
    const versioned = (mcp?: NetworkEndpoint['mcp']) =>
      policyOf({
        host: 'mcp.example.com',
        port: 443,
        protocol: 'mcp',
        rules: [{ allow: { method: 'tools/list' } }],
        ...(mcp ? { mcp } : {}),
      });
    const explicit = versioned({ versions: [DEFAULT_MCP_VERSION] });
    for (const format of ['yaml', 'json'] as const) {
      expect(write(versioned(), format)).toBe(write(explicit, format));
      expect(write(versioned({}), format)).toBe(write(explicit, format));
    }
    expect(
      JSON.parse(write(versioned({}), 'json')).network_policies.api.endpoints[0]
        .mcp.versions,
    ).toEqual([DEFAULT_MCP_VERSION]);
  });

  // mcp_version_checked_canonicalization_returns_valid_semantic_order and
  // canonical_serializers_do_not_enforce_unrelated_mutation_safety_rules:
  // writing a policy does not judge it, so one the gateway would refuse for
  // running as root is still written, with its revisions in order.
  it('writes revisions in order, and does not judge the rest of the policy', () => {
    const policy: SandboxPolicy = {
      ...policyOf({
        host: 'mcp.example.com',
        protocol: 'mcp',
        mcp: { versions: ['2025-11-25', '2025-03-26', '2025-06-18'] },
      }),
      process: { runAsUser: 'root', runAsGroup: 'sandbox' },
    };
    expect(endpointIn(write(policy)).mcp).toEqual({
      versions: ['2025-03-26', '2025-06-18', '2025-11-25'],
    });
    expect(
      (parseYaml(write(policy)) as { process: Doc }).process.run_as_user,
    ).toBe('root');
  });

  // canonical_serializers_reject_invalid_mcp_policy_before_conversion and
  // mcp_version_canonicalization_preserves_invalid_and_duplicate_entries:
  // what is wrong is said, all of it, and nothing is put right in passing.
  it.each([
    [
      'a revision twice',
      'mcp',
      { versions: ['2025-03-26', '2025-03-26'] },
      "repeats protocol version '2025-03-26'",
    ],
    [
      'an alias',
      'mcp',
      { versions: ['latest'] },
      "unsupported protocol version 'latest'",
    ],
    [
      'space after a revision',
      'mcp',
      { versions: ['2025-03-26 '] },
      "unsupported protocol version '2025-03-26 '",
    ],
    [
      'options on a REST endpoint',
      'rest',
      {},
      "endpoint 'h' uses protocol 'rest' and cannot configure mcp options",
    ],
    [
      'revisions on a JSON-RPC endpoint',
      'json-rpc',
      { versions: ['2025-03-26'] },
      "endpoint 'h' uses protocol 'json-rpc' and cannot configure mcp options",
    ],
  ])('does not write %s', (_case, protocol, mcp, message) => {
    const policy = policyOf({ host: 'h', protocol, mcp });
    expect(unwritable(policy)).toContain(
      `cannot serialize invalid sandbox policy: sandbox policy validation failed; network policy 'api': `,
    );
    expect(unwritable(policy)).toContain(message);
    expect(serializePolicyFile(policy, 'json').text).toBeUndefined();
  });

  it('says everything that is wrong with the revisions of a policy at once', () => {
    const message = unwritable(
      policyOf({
        host: 'h',
        protocol: 'mcp',
        mcp: {
          versions: [
            'unknown-z',
            '2025-11-25',
            '2025-03-26',
            '2025-03-26',
            'unknown-a',
          ],
        },
      }),
    );
    expect(message).toContain("unsupported protocol version 'unknown-z'");
    expect(message).toContain("unsupported protocol version 'unknown-a'");
    expect(message).toContain("repeats protocol version '2025-03-26'");
  });
});

describe('network middleware', () => {
  // round_trip_preserves_network_middlewares
  it('reads every field of a middleware, and names one by its key', () => {
    const yaml = `version: 1
network_middlewares:
  global-redactor:
    name: Global redactor
    middleware: openshell/regex
    order: 20
    on_error: fail_open
    endpoints:
      include: ["api.example.com", "*.service.test"]
      exclude: ["internal.example.com"]
    config:
      mode: redact
  secondary-redactor:
    middleware: openshell/regex
    endpoints:
      include: ["api.example.com"]
network_policies:
  api:
    name: api
    endpoints:
      - host: api.example.com
        port: 443
        protocol: rest
    binaries:
      - path: /usr/bin/curl
`;
    const policy = read(yaml);
    expect(policy.networkMiddlewares).toEqual({
      'global-redactor': {
        name: 'Global redactor',
        middleware: 'openshell/regex',
        order: 20,
        onError: 'fail_open',
        endpoints: {
          include: ['api.example.com', '*.service.test'],
          exclude: ['internal.example.com'],
        },
        config: { mode: 'redact' },
      },
      'secondary-redactor': {
        name: 'secondary-redactor',
        middleware: 'openshell/regex',
        // A config is always sent, with or without anything in it.
        config: {},
        endpoints: { include: ['api.example.com'] },
      },
    });
    expect(read(write(policy)).networkMiddlewares).toEqual(
      policy.networkMiddlewares,
    );
  });

  it('requires a middleware to say which it is', () => {
    expect(refusal('version: 1\nnetwork_middlewares:\n  audit: {}\n')).toBe(
      'failed to decode sandbox policy fields: network_middlewares.audit: missing field `middleware`',
    );
  });

  it('keeps a selector that is there and empty apart from none', () => {
    const policy = read(
      'version: 1\nnetwork_middlewares:\n  a:\n    middleware: logger\n    endpoints: {}\n  b:\n    middleware: logger\n',
    );
    expect(policy.networkMiddlewares?.a.endpoints).toEqual({});
    expect(policy.networkMiddlewares?.b).not.toHaveProperty('endpoints');
    expect(read(write(policy))).toEqual(policy);
  });

  // accepts_open_user_data_maps
  it('takes any JSON for a config, at any depth', () => {
    const policy = read(`version: 1
network_middlewares:
  audit:
    middleware: logger
    config:
      arbitrary_plugin_key: { nested: true }
      list: [1, 2.5, "three", null, [4], { five: 5 }]
      negative: -7
      text: "no"
      nothing: ~
`);
    expect(policy.networkMiddlewares?.audit.config).toEqual({
      arbitrary_plugin_key: { nested: true },
      list: [1, 2.5, 'three', null, [4], { five: 5 }],
      negative: -7,
      text: 'no',
      nothing: null,
    });
    expect(read(write(policy))).toEqual(policy);
    // And a policy with such a config is still JSON.
    expect(JSON.parse(JSON.stringify(policy))).toEqual(policy);
  });

  it('writes a config with its keys in order, at every depth', () => {
    const yaml = write({
      version: 1,
      networkMiddlewares: {
        audit: {
          middleware: 'logger',
          config: { zeta: 1, alpha: { yankee: 2, bravo: [{ d: 1, c: 2 }] } },
        },
      },
    });
    expect(yaml).toMatch(
      /alpha:[\s\S]*bravo:[\s\S]*c: 2[\s\S]*d: 1[\s\S]*yankee:[\s\S]*zeta:/,
    );
  });

  // rejects_integer_that_cannot_round_trip_through_protobuf_double and
  // accepts_integer_that_round_trips_through_protobuf_double: the API holds
  // every number of a config as a double.
  // It used to throw a RangeError (BigInt(Infinity)) and take the page with
  // it. A number that long is past what a double can hold at all.
  it('refuses a whole number in a config that is too long to be a number', () => {
    const huge = '9'.repeat(309);
    const source = `version: 1\nnetwork_middlewares:\n  audit:\n    middleware: logger\n    config:\n      big: ${huge}\n`;
    expect(() => parsePolicyFile(source)).not.toThrow();
    expect(refusal(source)).toBe(
      'failed to decode sandbox policy fields: network_middlewares.audit.config.big: failed to convert network middleware config: a whole number of 309 digits is not a number JSON can hold',
    );
    expect(refusal(source.replace('big: 9', 'big: -9'))).toContain(
      'a whole number of 309 digits is not a number JSON can hold',
    );
    expect(() =>
      readPolicyText(
        `{"version": 1, "network_middlewares": {"a": {"middleware": "m", "config": {"big": ${huge}}}}}`,
      ),
    ).not.toThrow();
  });

  it('reads a whole number too large for 64 bits as the float upstream reads it as', () => {
    // 10^30 is not exact as a double, and upstream does not ask it to be: it
    // holds whole numbers in 64 bits and anything larger as a float.
    const policy = read(
      'version: 1\nnetwork_middlewares:\n  audit:\n    middleware: logger\n    config:\n      big: 1000000000000000000000000000000\n      edge: 9223372036854775808\n',
    );
    expect(policy.networkMiddlewares?.audit.config).toEqual({
      big: 1e30,
      edge: 9223372036854775808,
    });
    expect(() => JSON.stringify(policy)).not.toThrow();
  });

  it('refuses a whole number in a config that a double cannot hold', () => {
    const config = (number: string) =>
      `version: 1\nnetwork_middlewares:\n  audit:\n    middleware: logger\n    config:\n      limits: { big: ${number} }\n`;
    expect(refusal(config('9007199254740993'))).toBe(
      'failed to decode sandbox policy fields: network_middlewares.audit.config.limits.big: failed to convert network middleware config: JSON number 9007199254740993 cannot be represented exactly as a protobuf double',
    );
    expect(
      read(config('9007199254740992')).networkMiddlewares?.audit.config,
    ).toEqual({ limits: { big: 9007199254740992 } });
    // The same in the JSON form of a file, where JSON.parse would round it.
    expect(
      readPolicyText(
        '{"version": 1, "network_middlewares": {"audit": {"middleware": "logger", "config": {"big": 9007199254740993}}}}',
      ).diagnostics.map((d) => d.message),
    ).toEqual([
      expect.stringContaining(
        'JSON number 9007199254740993 cannot be represented exactly',
      ),
    ]);
  });

  // Upstream sends null for these. JSON has no such number, and a config
  // that says .inf does not mean null.
  it.each(['.inf', '-.inf', '.nan'])(
    'refuses %s in a config, which JSON cannot hold',
    (number) => {
      expect(
        refusal(
          `version: 1\nnetwork_middlewares:\n  audit:\n    middleware: logger\n    config:\n      ratio: ${number}\n`,
        ),
      ).toMatch(
        /^failed to decode sandbox policy fields: network_middlewares\.audit\.config\.ratio: failed to convert network middleware config: .* is not a number JSON can hold$/,
      );
    },
  );

  it('reads order as a whole number of either sign', () => {
    const order = (value: string) =>
      `version: 1\nnetwork_middlewares:\n  a:\n    middleware: m\n    order: ${value}\n`;
    expect(read(order('-5')).networkMiddlewares?.a.order).toBe(-5);
    expect(read(order('0')).networkMiddlewares?.a).not.toHaveProperty('order');
    expect(refusal(order('2147483648'))).toContain(
      'network_middlewares.a.order: expected a whole number',
    );
    expect(refusal(order('first'))).toContain(
      'network_middlewares.a.order: expected a whole number, found string "first"',
    );
  });

  // parse_rejects_middleware_attachments_on_network_policies_and_endpoints
  it('has no way to attach a middleware to a rule or an endpoint', () => {
    expect(
      refusal(
        'version: 1\nnetwork_policies:\n  api:\n    middleware: [redact]\n    endpoints:\n      - host: api.example.com\n        port: 443\n',
      ),
    ).toBe(
      "unknown field 'network_policies.api.middleware' in authored policy",
    );
    expect(
      refusal(`${ENDPOINT}        port: 443\n        middleware: [redact]\n`),
    ).toBe(
      "unknown field 'network_policies.api.endpoints[0].middleware' in authored policy",
    );
  });
});

// --- What is refused ---

describe('unknown fields', () => {
  // rejects_unknown_fields_at_every_closed_schema_level, case for case.
  it.each([
    ['version: 1\nfuture: true\n', 'future'],
    [
      'version: 1\nfilesystem_policy: { future: true }\n',
      'filesystem_policy.future',
    ],
    ['version: 1\nlandlock: { future: true }\n', 'landlock.future'],
    ['version: 1\nprocess: { future: true }\n', 'process.future'],
    [
      'version: 1\nnetwork_policies: { api: { future: true } }\n',
      'network_policies.api.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, future: true }] } }\n',
      'network_policies.api.endpoints[0].future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { binaries: [{ path: /bin/tool, future: true }] } }\n',
      'network_policies.api.binaries[0].future',
    ],
    [
      'version: 1\nnetwork_middlewares: { audit: { middleware: logger, future: true } }\n',
      'network_middlewares.audit.future',
    ],
    [
      'version: 1\nnetwork_middlewares: { audit: { middleware: logger, endpoints: { future: true } } }\n',
      'network_middlewares.audit.endpoints.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, credential_binding: { provider: p, future: true } }] } }\n',
      'network_policies.api.endpoints[0].credential_binding.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, json_rpc: { future: true } }] } }\n',
      'network_policies.api.endpoints[0].json_rpc.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, protocol: mcp, mcp: { future: true } }] } }\n',
      'network_policies.api.endpoints[0].mcp.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, graphql_persisted_queries: { op: { future: true } } }] } }\n',
      'network_policies.api.endpoints[0].graphql_persisted_queries.op.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, rules: [{ future: true, allow: {} }] }] } }\n',
      'network_policies.api.endpoints[0].rules[0].future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, rules: [{ allow: { future: true } }] }] } }\n',
      'network_policies.api.endpoints[0].rules[0].allow.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, deny_rules: [{ future: true }] }] } }\n',
      'network_policies.api.endpoints[0].deny_rules[0].future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, rules: [{ allow: { query: { q: { any: [one], future: true } } } }] }] } }\n',
      'network_policies.api.endpoints[0].rules[0].allow.query.q.future',
    ],
    [
      'version: 1\nnetwork_policies: { api: { endpoints: [{ host: example.com, port: 443, rules: [{ allow: { tool: { any: [one], future: true } } }] }] } }\n',
      'network_policies.api.endpoints[0].rules[0].allow.tool.future',
    ],
  ])('refuses %s', (source, path) => {
    const parsed = parsePolicyFile(source);
    expect(parsed.policy).toBeUndefined();
    expect(parsed.diagnostics).toEqual([
      { path, message: `unknown field '${path}' in authored policy` },
    ]);
  });

  // parse_rejects_unknown_fields and parse_rejects_unknown_fields_in_deny_rule
  it('refuses them wherever they are, and names every one', () => {
    expect(refusal('version: 1\nbogus_field: true\n')).toBe(
      "unknown field 'bogus_field' in authored policy",
    );
    expect(
      refusal(
        `${ENDPOINT}        port: 443\n        enforcment: enforce\n        deny_rules:\n          - method: POST\n            path: /foo\n            bogus: true\n`,
      ),
    ).toBe(
      [
        "unknown field 'network_policies.api.endpoints[0].enforcment' in authored policy",
        "unknown field 'network_policies.api.endpoints[0].deny_rules[0].bogus' in authored policy",
      ].join('\n'),
    );
  });

  // rejects_unsupported_managed_metadata_and_review
  it('refuses the metadata and review sections upstream does not have', () => {
    const message = refusal(`version: 1
metadata:
  policy_id: managed/default
  version: 7
network_policies:
  api:
    endpoints:
      - host: example.com
        port: 443
        review: { required: true, reason: human approval }
        rules:
          - allow:
              method: GET
              path: /v1/**
              review: { required: true, reason: broad path }
`);
    expect(message.split('\n')).toEqual([
      "unknown field 'metadata' in authored policy",
      "unknown field 'network_policies.api.endpoints[0].review' in authored policy",
      "unknown field 'network_policies.api.endpoints[0].rules[0].allow.review' in authored policy",
    ]);
  });

  it("refuses the API's own spelling of a field in a policy file", () => {
    expect(refusal('version: 1\nnetworkPolicies: {}\n')).toBe(
      "unknown field 'networkPolicies' in authored policy",
    );
    expect(refusal('version: 1\nfilesystem: {}\n')).toBe(
      "unknown field 'filesystem' in authored policy",
    );
  });

  // bounds_unknown_field_diagnostics_for_wide_maps_under_long_keys
  it('keeps what it says short when there are many, under a long name', () => {
    const wide = (name: string) =>
      parsePolicyFile(
        `version: 1\nnetwork_policies:\n  ${name}:\n${Array.from(
          { length: 2000 },
          (_, index) => `      unknown_${index}: true\n`,
        ).join('')}`,
      );
    const parsed = wide('é'.repeat(1020));
    expect(parsed.policy).toBeUndefined();
    // The first ten, each cut to length, and how many more there are.
    expect(parsed.diagnostics).toHaveLength(11);
    expect(parsed.diagnostics[0].message).toMatch(
      /^unknown field 'network_policies\.é+\.\.\.' in authored policy$/,
    );
    expect(parsed.diagnostics[0].message.length).toBeLessThanOrEqual(1024 + 50);
    expect(parsed.diagnostics[10].message).toBe('and 1990 more unknown fields');

    // Upstream's own case has a name of 2000 characters. YAML allows a key
    // written this way 1024, and the parser here holds to that where
    // upstream's does not, so that file is refused one step earlier.
    expect(wide('é'.repeat(2000)).diagnostics).toEqual([
      {
        path: '',
        message:
          'failed to parse sandbox policy YAML: The : indicator must be at most 1024 chars after the start of an implicit block mapping key at line 3, column 3',
      },
    ]);
  });

  it("reports a field of the API's policy it does not know, and writes no file", () => {
    const written = serializePolicyFile(
      {
        version: 1,
        networkPolicies: {
          api: {
            endpoints: [{ host: 'a.example', allowed_ips: ['10.0.0.0/8'] }],
            binarys: [],
          },
        },
        landlock: { compatability: 'best_effort' },
      } as unknown as SandboxPolicy,
      'yaml',
    );
    expect(written.text).toBeUndefined();
    expect(written.diagnostics.map((d) => d.path).sort()).toEqual([
      'landlock.compatability',
      'networkPolicies.api.binarys',
      'networkPolicies.api.endpoints[0].allowed_ips',
    ]);
    expect(written.diagnostics[0].message).toContain(
      'it is not a field of a policy, and a policy file has no place for it',
    );
  });

  it("reads a null in the API's policy as a field that is not set", () => {
    expect(
      parseYaml(
        write({
          version: 1,
          filesystem: null,
          networkPolicies: { api: { name: null, endpoints: null } },
        } as unknown as SandboxPolicy),
      ),
    ).toEqual({ version: 1, network_policies: { api: {} } });
  });

  it("reports a value of the API's policy that is of the wrong type", () => {
    expect(
      unwritable(
        policyOf({ host: 'a.example', port: '443' as unknown as number }),
      ),
    ).toBe(
      'networkPolicies.api.endpoints[0].port: expected a port number, found string "443"',
    );
    expect(
      unwritable({
        version: 1,
        networkPolicies: [],
      } as unknown as SandboxPolicy),
    ).toBe('networkPolicies: expected a mapping, found a list');
  });
});

describe('what a policy file may not be', () => {
  // rejects_duplicate_keys
  it('refuses a key written twice', () => {
    expect(refusal('version: 1\nversion: 1\n')).toBe(
      'failed to parse sandbox policy YAML: Map keys must be unique at line 2, column 1',
    );
  });

  // Upstream sets merge_key_policy = Error. A merge key that was read as an
  // ordinary key would be an unknown field where the schema is closed, and
  // where it is not (a middleware's config, the rules, the parameters of a
  // rule) it would be an entry called `<<` and the fields its author meant
  // to merge in would be left out without a word.
  it.each([
    [
      'a section of the schema',
      'version: 1\nfilesystem_policy: &fs\n  include_workdir: true\nlandlock:\n  <<: *fs\n',
      'line 5, column 3',
    ],
    [
      "a middleware's config, which may hold any key",
      'version: 1\nnetwork_middlewares:\n  a:\n    middleware: logger\n    config: &defaults\n      mode: redact\n  b:\n    middleware: logger\n    config:\n      <<: *defaults\n      extra: 1\n',
      'line 10, column 7',
    ],
    [
      'the rules, which are named by their keys',
      'version: 1\nnetwork_policies:\n  api: &api\n    endpoints:\n      - host: a.example\n  <<: *api\n',
      'line 6, column 3',
    ],
    [
      'the query of a rule',
      'version: 1\nnetwork_policies:\n  api:\n    endpoints:\n      - host: a.example\n        rules:\n          - allow:\n              query: { <<: { tag: "x" } }\n',
      'line 8, column 24',
    ],
    [
      'the nested params of an MCP rule',
      'version: 1\nnetwork_policies:\n  api:\n    endpoints:\n      - host: a.example\n        protocol: mcp\n        rules:\n          - allow:\n              params:\n                arguments:\n                  <<: { repo: "x" }\n',
      'line 11, column 19',
    ],
  ])('refuses a merge key in %s, and says where', (_case, source, where) => {
    expect(refusal(source)).toBe(
      `failed to parse sandbox policy YAML: merge key \`<<\` at ${where}: a policy file may not use YAML merge keys; write the fields out`,
    );
  });

  it('takes `<<` in quotes for the plain name it is', () => {
    // Only the bare `<<` is a merge key. Quoted it is a string like any
    // other: data where any key may stand, and an unknown field elsewhere.
    expect(
      read(
        'version: 1\nnetwork_middlewares:\n  a:\n    middleware: logger\n    config:\n      "<<": kept\n',
      ).networkMiddlewares?.a.config,
    ).toEqual({ '<<': 'kept' });
    expect(refusal('version: 1\nlandlock:\n  "<<": x\n')).toBe(
      "unknown field 'landlock.<<' in authored policy",
    );
    // The JSON form of a file has no bare keys at all.
    expect(
      readPolicyText(
        '{"version": 1, "network_middlewares": {"a": {"middleware": "logger", "config": {"<<": "kept"}}}}',
      ).policy?.networkMiddlewares?.a.config,
    ).toEqual({ '<<': 'kept' });
  });

  it('follows an alias, which upstream allows', () => {
    expect(
      read(
        'version: 1\nfilesystem_policy:\n  read_only: &paths [/usr, /etc]\n  read_write: *paths\n',
      ).filesystem,
    ).toEqual({ readOnly: ['/usr', '/etc'], readWrite: ['/usr', '/etc'] });
  });

  it('refuses more than one document', () => {
    expect(refusal('version: 1\n---\nversion: 1\n')).toMatch(
      /^failed to parse sandbox policy YAML: /,
    );
  });

  it('refuses a text that is not a mapping', () => {
    expect(refusal('')).toBe(
      'failed to decode sandbox policy fields: expected a mapping, found null',
    );
    expect(refusal('- version: 1\n')).toBe(
      'failed to decode sandbox policy fields: expected a mapping, found a list',
    );
    expect(refusal('just some text')).toBe(
      'failed to decode sandbox policy fields: expected a mapping, found string "just some text"',
    );
  });

  it('says where a text stops being YAML', () => {
    expect(refusal('version: 1\nnetwork_policies: [\n')).toMatch(
      /^failed to parse sandbox policy YAML: .* at line \d+, column \d+$/,
    );
  });

  // explicit_null_does_not_collapse_to_omission: a null is not a section
  // left out.
  it.each([
    ['version: 1\nfilesystem_policy: null\n', 'filesystem_policy'],
    ['version: 1\nprocess: null\n', 'process'],
    ['version: 1\nlandlock: ~\n', 'landlock'],
    [
      'version: 1\nnetwork_policies:\n  x:\n    endpoints:\n      - host: x\n        port: 443\n        mcp: null\n',
      'network_policies.x.endpoints[0].mcp',
    ],
    ['version: 1\nnetwork_policies:\n', 'network_policies'],
  ])('refuses the null in %s', (source, path) => {
    expect(refusal(source)).toBe(
      `failed to decode sandbox policy fields: ${path}: expected a mapping, found null`,
    );
  });

  it('reads YAML 1.2, in which yes and no are strings and a date is one too', () => {
    expect(
      refusal('version: 1\nfilesystem_policy:\n  include_workdir: yes\n'),
    ).toBe(
      'failed to decode sandbox policy fields: filesystem_policy.include_workdir: expected true or false, found string "yes"',
    );
    expect(
      withEndpoint(
        '        protocol: mcp\n        mcp:\n          versions: [2025-03-26]\n',
      ).mcp?.versions,
    ).toEqual(['2025-03-26']);
    expect(
      withEndpoint('        allowed_ips:\n          - 2001:db8::/32\n')
        .allowedIps,
    ).toEqual(['2001:db8::/32']);
  });

  it('refuses a number where a string goes, and a string where a number goes', () => {
    expect(refusal('version: "1"\n')).toBe(
      'failed to decode sandbox policy fields: version: expected a whole number, found string "1"',
    );
    expect(refusal(`${ENDPOINT}        path: 5\n`)).toBe(
      'failed to decode sandbox policy fields: network_policies.api.endpoints[0].path: expected a string, found number 5',
    );
    expect(refusal('version: 1\nfilesystem_policy:\n  read_only: /usr\n')).toBe(
      'failed to decode sandbox policy fields: filesystem_policy.read_only: expected a list, found string "/usr"',
    );
    expect(
      refusal('version: 1\nfilesystem_policy:\n  read_only: [/usr, 7]\n'),
    ).toBe(
      'failed to decode sandbox policy fields: filesystem_policy.read_only[1]: expected a string, found number 7',
    );
  });

  // bounded_reader_rejects_growth_past_limit_and_invalid_utf8: 4 MiB.
  it('refuses a policy over the size upstream reads', () => {
    const limit = 4 * 1024 * 1024;
    const padding = (bytes: number) =>
      `version: 1\n# ${'x'.repeat(bytes - 'version: 1\n# \n'.length)}\n`;
    expect(read(padding(limit))).toEqual({ version: 1 });
    expect(refusal(padding(limit + 1))).toBe(
      'failed to parse sandbox policy YAML: policy exceeds the 4194304-byte input limit',
    );
    // In bytes, not characters.
    expect(refusal(`version: 1\n# ${'é'.repeat(limit / 2)}\n`)).toContain(
      'input limit',
    );
  });
});

// --- The JSON form of a policy file ---

describe('the JSON form', () => {
  // serialized_json_uses_policy_schema_keys
  it('uses the names a policy file has', () => {
    const json = JSON.parse(
      write(
        read(
          'version: 1\nnetwork_policies:\n  github:\n    endpoints:\n      - host: api.github.com\n        port: 443\n        protocol: https\n    binaries:\n      - path: /usr/bin/curl\n',
        ),
        'json',
      ),
    );
    expect(json.version).toBe(1);
    expect(json).not.toHaveProperty('filesystem');
    expect(json.network_policies.github.endpoints[0]).toEqual({
      host: 'api.github.com',
      port: 443,
      protocol: 'https',
    });
  });

  it('has its keys in order at every depth, as upstream writes JSON', () => {
    const text = write(read(EVERY_FIELD), 'json');
    const sorted = (value: unknown): boolean => {
      if (Array.isArray(value)) {
        return value.every(sorted);
      }
      if (value === null || typeof value !== 'object') {
        return true;
      }
      const keys = Object.keys(value);
      return (
        keys.join() === [...keys].sort().join() &&
        Object.values(value).every(sorted)
      );
    };
    expect(sorted(JSON.parse(text))).toBe(true);
    expect(text.startsWith('{\n  "filesystem_policy": {\n')).toBe(true);
    expect(text.endsWith('\n}\n')).toBe(true);
  });

  it('is read as the YAML is', () => {
    const policy = read(EVERY_FIELD);
    expect(read(write(policy, 'json'))).toEqual(policy);
    expect(readPolicyText(write(policy, 'json'))).toEqual({
      format: 'json',
      policy,
      diagnostics: [],
    });
  });
});

// --- Any text ---

describe('readPolicyText', () => {
  const API_POLICY: SandboxPolicy = {
    version: 1,
    filesystem: { includeWorkdir: true, readOnly: ['/usr'] },
    networkPolicies: {
      web: {
        name: 'web',
        endpoints: [
          {
            host: 'a.example',
            port: 443,
            ports: [443],
            protocol: 'rest',
            access: 'NETWORK_ACCESS_PRESET_FULL',
          },
        ],
      },
    },
  };

  it('tells YAML from JSON by how the text starts', () => {
    expect(policyTextFormat('version: 1\n')).toBe('yaml');
    expect(policyTextFormat('# a comment\nversion: 1\n')).toBe('yaml');
    expect(policyTextFormat('{"version": 1}')).toBe('json');
    expect(policyTextFormat('\n  {\n')).toBe('json');
    expect(policyTextFormat('')).toBe('yaml');
  });

  it('reads a policy file in YAML', () => {
    expect(readPolicyText(write(API_POLICY))).toEqual({
      format: 'yaml',
      policy: API_POLICY,
      diagnostics: [],
    });
  });

  it("returns the API's own JSON as it was written", () => {
    // Not checked and not changed: the gateway's schema is its judge, as it
    // was before the dashboard read policy files.
    const typed = {
      ...API_POLICY,
      networkPolicies: { web: { endpoints: [{ host: 'a', somethingNew: 1 }] } },
    };
    expect(readPolicyText(JSON.stringify(typed, null, 2))).toEqual({
      format: 'json',
      policy: typed,
      diagnostics: [],
    });
    expect(readPolicyText('{}').policy).toEqual({});
    expect(readPolicyText('{"version": 1}').policy).toEqual({ version: 1 });
  });

  it('reads a policy file in JSON by the names it uses', () => {
    expect(
      readPolicyText(
        '{"version": 1, "filesystem_policy": {"include_workdir": true}}',
      ).policy,
    ).toEqual({ version: 1, filesystem: { includeWorkdir: true } });
    expect(
      readPolicyText('{"version": 1, "network_policies": {}}').policy,
    ).toEqual({ version: 1 });
    // A file that sets only what both spell the same is told by its process
    // section, and otherwise reads the same either way.
    expect(
      readPolicyText('{"version": 1, "process": {"run_as_user": "1500"}}')
        .policy,
    ).toEqual({ version: 1, process: { runAsUser: '1500' } });
    expect(
      readPolicyText('{"version": 1, "process": {"runAsUser": "1500"}}').policy,
    ).toEqual({ version: 1, process: { runAsUser: '1500' } });
  });

  it('checks a policy file in JSON as it checks one in YAML', () => {
    expect(
      readPolicyText(
        '{"version": 1, "network_policies": {"api": {"endpoints": [{"host": "a", "tls": "terminate"}]}}}',
      ).diagnostics.map((d) => d.message),
    ).toEqual([
      "network policy 'api': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
    ]);
    expect(
      readPolicyText('{"network_policies": {}}').diagnostics.map(
        (d) => d.message,
      ),
    ).toEqual([
      'failed to decode sandbox policy fields: missing field `version`',
    ]);
    // JSON.parse keeps the second of two keys and says nothing.
    expect(
      readPolicyText(
        '{"version": 1, "network_policies": {}, "network_policies": {}}',
      ).diagnostics.map((d) => d.message),
    ).toEqual([
      expect.stringMatching(
        /^failed to parse sandbox policy YAML: Map keys must be unique/,
      ),
    ]);
  });

  it('refuses a document that mixes the two spellings', () => {
    const reading = readPolicyText(
      '{"version": 1, "network_policies": {}, "filesystem": {}}',
    );
    expect(reading.policy).toBeUndefined();
    expect(reading.diagnostics.map((d) => d.message)).toEqual([
      "the document mixes the fields of a policy file (network_policies) with the fields of the gateway's JSON (filesystem); use one or the other",
    ]);
  });

  it('says so when a text that starts as JSON is not', () => {
    const reading = readPolicyText('{"version": 1,');
    expect(reading.format).toBe('json');
    expect(reading.policy).toBeUndefined();
    expect(reading.diagnostics[0].message).toMatch(/^Invalid JSON: /);
  });

  it('reads a YAML mapping written in braces', () => {
    expect(readPolicyText('{ version: 1, landlock: {} }').policy).toEqual({
      version: 1,
      landlock: { compatibility: 'best_effort' },
    });
  });

  it('gives no policy for a text that holds none', () => {
    for (const text of ['', '   \n', '[]', '"text"', '42']) {
      const reading = readPolicyText(text);
      expect(reading.policy).toBeUndefined();
      expect(reading.diagnostics).toHaveLength(1);
    }
  });
});

describe('policyToText', () => {
  const policy: SandboxPolicy = {
    version: 1,
    networkPolicies: {
      web: {
        name: 'web',
        endpoints: [
          {
            host: 'a.example',
            port: 443,
            ports: [443],
            enforcement: 'NETWORK_ENFORCEMENT_MODE_AUDIT',
          },
        ],
      },
    },
  };

  it("writes JSON as the API's own, which is what the dashboard always showed", () => {
    expect(policyToText(policy, 'json')).toEqual({
      text: JSON.stringify(policy, null, 2),
      diagnostics: [],
    });
  });

  it('writes YAML as the policy file', () => {
    expect(policyToText(policy, 'yaml').text).toBe(
      'version: 1\nnetwork_policies:\n  web:\n    name: web\n    endpoints:\n      - host: a.example\n        port: 443\n        enforcement: audit\n',
    );
  });

  it('reads back either as the policy it wrote', () => {
    for (const format of ['yaml', 'json'] as const) {
      const text = policyToText(policy, format).text ?? '';
      expect(readPolicyText(text)).toEqual({
        format,
        policy,
        diagnostics: [],
      });
    }
  });

  it('writes strings a YAML reader would take for something else in quotes', () => {
    const yaml =
      policyToText(
        {
          version: 1,
          process: { runAsUser: '1500', runAsGroup: 'true' },
          filesystem: { readOnly: ['*', 'null', '~', 'a: b', '# c', ''] },
        },
        'yaml',
      ).text ?? '';
    expect(read(yaml)).toEqual({
      version: 1,
      process: { runAsUser: '1500', runAsGroup: 'true' },
      filesystem: { readOnly: ['*', 'null', '~', 'a: b', '# c', ''] },
    });
  });
});

describe('hasGatewayMarks', () => {
  const marked = (endpoint: NetworkEndpoint): SandboxPolicy => ({
    version: 1,
    networkPolicies: {
      plain: { endpoints: [{ host: 'a.example', port: 443 }] },
      marked: { endpoints: [{ host: 'b.example' }, endpoint] },
    },
  });

  it('finds the marks a policy file is written without', () => {
    expect(hasGatewayMarks({ version: 1 })).toBe(false);
    expect(hasGatewayMarks(marked({ host: 'c.example' }))).toBe(false);
    expect(
      hasGatewayMarks(
        marked({ host: 'c.example', providerCredentialed: false }),
      ),
    ).toBe(false);
    for (const mark of ['providerCredentialed', 'advisorProposed'] as const) {
      const policy = marked({ host: 'c.example', [mark]: true });
      expect(hasGatewayMarks(policy)).toBe(true);
      // And those are exactly the policies whose YAML says less than they do.
      expect(read(write(policy))).not.toEqual(policy);
    }
    expect(read(write(marked({ host: 'c.example' })))).toEqual({
      version: 1,
      networkPolicies: {
        plain: {
          name: 'plain',
          endpoints: [{ host: 'a.example', port: 443, ports: [443] }],
        },
        marked: {
          name: 'marked',
          endpoints: [{ host: 'b.example' }, { host: 'c.example' }],
        },
      },
    });
  });
});

// --- Anything at all ---

// A small generator of the same numbers every run.
const randomOf = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('whatever it is given', () => {
  const random = randomOf(20261007);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)];
  const upTo = (max: number) => Math.floor(random() * (max + 1));

  // What reading a text has to give back, whatever the text: a policy and no
  // diagnostics, or diagnostics and no policy. And a policy that came back
  // has to be one that can be sent (JSON) and shown (either format).
  const checkReading = (reading: {
    policy?: SandboxPolicy;
    diagnostics: { path: string; message: string }[];
  }) => {
    if (reading.policy === undefined) {
      expect(reading.diagnostics.length).toBeGreaterThan(0);
      reading.diagnostics.forEach((diagnostic) => {
        expect(typeof diagnostic.path).toBe('string');
        expect(typeof diagnostic.message).toBe('string');
        expect(diagnostic.message).not.toBe('');
      });
      return;
    }
    expect(reading.diagnostics).toEqual([]);
    JSON.stringify(reading.policy);
    for (const format of ['yaml', 'json'] as const) {
      const written = serializePolicyFile(reading.policy, format);
      expect(written.text === undefined).toBe(written.diagnostics.length > 0);
      policyToText(reading.policy, format);
    }
    hasGatewayMarks(reading.policy);
  };

  const check = (text: string) => {
    try {
      policyTextFormat(text);
      checkReading(parsePolicyFile(text));
      checkReading(readPolicyText(text));
    } catch (error) {
      throw new Error(
        `threw for ${JSON.stringify(text.slice(0, 300))}: ${(error as Error).stack}`,
      );
    }
  };

  const SIGNS = [
    ...'{}[]:,-#&*!|>\'"%@`?~<=\\/.+ \n\t\r',
    '\u0000',
    '\ufeff',
    'é',
    '\ud83d',
    '<<',
    '---',
    '...',
    '!!binary ',
    '!!set ',
    '!!omap ',
    '!!str ',
    '!custom ',
    '&a ',
    '*a ',
    'null',
    'true',
    '~',
    '0x1F',
    '0o17',
    '.inf',
    '.nan',
    '1e400',
    '-0',
    '9'.repeat(400),
    'version',
    'network_policies',
    'networkPolicies',
    'endpoints',
    'config',
    'params',
    'rules',
    'allow',
    'mcp',
    'versions',
    'tool',
    'any',
    'port',
    'ports',
    'host',
    'tls',
    '__proto__',
    'constructor',
    'toString',
  ];

  it('answers random text with a policy or a reason, and never throws', () => {
    for (let run = 0; run < 1500; run += 1) {
      const length = upTo(60);
      let text = '';
      for (let index = 0; index < length; index += 1) {
        text += pick(SIGNS);
      }
      check(text);
    }
  });

  it('answers a policy file with random damage the same way', () => {
    const sources = [
      EVERY_FIELD,
      fixture('examples/sandbox-policy-quickstart/policy.yaml'),
      fixture('e2e/mcp-conformance/policy-template.yaml'),
      write(read(EVERY_FIELD), 'json'),
      JSON.stringify(read(EVERY_FIELD), null, 2),
    ];
    for (let run = 0; run < 1500; run += 1) {
      let text = pick(sources);
      for (let edits = 1 + upTo(3); edits > 0; edits -= 1) {
        const at = upTo(text.length);
        const span = upTo(12);
        const kind = upTo(3);
        if (kind === 0) {
          text = text.slice(0, at) + text.slice(at + span);
        } else if (kind === 1) {
          text = text.slice(0, at) + pick(SIGNS) + text.slice(at);
        } else if (kind === 2) {
          text = text.slice(0, at) + pick(SIGNS) + text.slice(at + span);
        } else {
          const line = pick(text.split('\n'));
          text = `${text.slice(0, at)}\n${line}\n${text.slice(at)}`;
        }
      }
      check(text);
    }
  });

  it.each([
    ['a sequence nested ten thousand deep', '['.repeat(10000)],
    ['a closed one', `${'['.repeat(3000)}${']'.repeat(3000)}`],
    ['a mapping nested ten thousand deep', '{a: '.repeat(10000)],
    [
      'params nested past the depth a document may have',
      `version: 1\nnetwork_policies:\n  api:\n    endpoints:\n      - host: a\n        protocol: mcp\n        rules:\n          - allow:\n              params: ${'{a: '.repeat(80)}x${'}'.repeat(80)}\n`,
    ],
    [
      'a config nested past it',
      `version: 1\nnetwork_middlewares:\n  a:\n    middleware: m\n    config: ${'{a: '.repeat(80)}1${'}'.repeat(80)}\n`,
    ],
    ['an alias to what holds it', 'a: &a\n  b: *a\n'],
    ['a hundred thousand aliases', `a: &a x\nb: [${'*a, '.repeat(100000)}]\n`],
    [
      'aliases that multiply',
      'a: &a [x, x]\nb: &b [*a, *a]\nc: &c [*b, *b]\nd: &d [*c, *c]\ne: &e [*d, *d]\nf: &f [*e, *e]\ng: &g [*f, *f]\nh: [*g, *g]\n',
    ],
    ['a key that is not a scalar', '? [a, b]\n: c\nversion: 1\n'],
    ['a thousand documents', 'version: 1\n---\n'.repeat(1000)],
    [
      'a number of a hundred thousand digits',
      `version: ${'1'.repeat(100000)}\n`,
    ],
    ['a megabyte on one line', `version: 1\nx: "${'y'.repeat(1 << 20)}"\n`],
    [
      'a thousand unknown fields',
      Array.from({ length: 1000 }, (_, i) => `k${i}: 1\n`).join(''),
    ],
    ['null bytes', 'version: 1\u0000\nnetwork_policies: {\u0000}\n'],
    [
      'a byte order mark and carriage returns',
      '\ufeffversion: 1\r\nlandlock: {}\r\n',
    ],
  ])('answers %s', (_case, text) => {
    check(text);
  });

  it('refuses a document nested deeper than upstream reads', () => {
    const nested = (depth: number) =>
      `version: 1\nnetwork_middlewares:\n  a:\n    middleware: m\n    config: ${'{a: '.repeat(depth)}1${'}'.repeat(depth)}\n`;
    // The first mapping of the config is three levels below the document,
    // so sixty-two of them reach the sixty-fourth level and no further.
    expect(read(nested(62)).networkMiddlewares?.a.middleware).toBe('m');
    expect(refusal(nested(63))).toBe(
      'failed to parse sandbox policy YAML: the document is nested deeper than 64 levels',
    );
    // The same for a document that did not come from text.
    const document = (depth: number) => {
      let config: unknown = 1;
      for (let level = 0; level < depth; level += 1) {
        config = { a: config };
      }
      return {
        version: 1,
        network_middlewares: { a: { middleware: 'm', config } },
      };
    };
    expect(policyFromDocument(document(62)).diagnostics).toEqual([]);
    expect(policyFromDocument(document(63)).diagnostics).toEqual([
      {
        path: '',
        message:
          'failed to decode sandbox policy fields: the document is nested deeper than 64 levels',
      },
    ]);
  });

  // Not text: the values the document functions are handed directly.
  const junk = (depth: number): unknown => {
    const kind = upTo(depth > 4 ? 9 : 13);
    const key = () =>
      pick([
        'version',
        'filesystem_policy',
        'filesystem',
        'landlock',
        'process',
        'network_policies',
        'networkPolicies',
        'network_middlewares',
        'networkMiddlewares',
        'name',
        'endpoints',
        'binaries',
        'path',
        'host',
        'port',
        'ports',
        'protocol',
        'tls',
        'enforcement',
        'access',
        'rules',
        'allow',
        'deny_rules',
        'denyRules',
        'query',
        'params',
        'tool',
        'any',
        'glob',
        'mcp',
        'versions',
        'json_rpc',
        'jsonRpcMaxBodyBytes',
        'config',
        'middleware',
        'order',
        'compatibility',
        'readOnly',
        'read_only',
        '__proto__',
        'constructor',
        '<<',
        '',
      ]);
    switch (kind) {
      case 0:
        return null;
      case 1:
        return undefined;
      case 2:
        return pick([
          0,
          1,
          -1,
          443,
          65536,
          1.5,
          NaN,
          Infinity,
          -Infinity,
          2 ** 53,
        ]);
      case 3:
        return pick([
          BigInt(1),
          BigInt(-1),
          BigInt('9'.repeat(400)),
          BigInt(443),
        ]);
      case 4:
        return pick([
          '',
          'mcp',
          'MCP',
          'rest',
          'skip',
          'terminate',
          'x',
          '1',
          '2025-11-25',
        ]);
      case 5:
        return random() < 0.5;
      case 6:
        return pick([
          new Date(0),
          () => 1,
          Symbol('s'),
          /x/,
          new Map(),
          new Set([1]),
        ]);
      case 7:
        return 'NETWORK_TLS_MODE_SKIP';
      case 8:
      case 9:
        return pick([1, 'a', true]);
      case 10:
      case 11:
        return Array.from({ length: upTo(3) }, () => junk(depth + 1));
      default: {
        const entries: [string, unknown][] = Array.from(
          { length: upTo(5) },
          () => [key(), junk(depth + 1)],
        );
        return Object.fromEntries(entries);
      }
    }
  };

  it('answers any value where a document or a policy is expected', () => {
    const self: Record<string, unknown> = { version: 1 };
    self.networkPolicies = { loop: self };
    self.network_policies = { loop: self };
    const deep: unknown[] = [];
    let level = deep;
    for (let depth = 0; depth < 20000; depth += 1) {
      const next: unknown[] = [];
      level.push(next);
      level = next;
    }
    const values: unknown[] = [
      self,
      deep,
      {
        version: 1,
        network_middlewares: { a: { middleware: 'm', config: deep } },
      },
      {
        version: 1,
        networkMiddlewares: { a: { middleware: 'm', config: self } },
      },
      Object.create(null),
    ];
    for (let run = 0; run < 3000; run += 1) {
      values.push(junk(0));
    }
    for (const value of values) {
      let shown = '';
      try {
        shown = String(JSON.stringify(value)).slice(0, 300);
      } catch {
        shown = '(not JSON)';
      }
      try {
        checkReading(policyFromDocument(value));
        findUnknownFields(value);
        const written = policyToDocument(value);
        expect(written.document === undefined).toBe(
          written.diagnostics.length > 0,
        );
        for (const format of ['yaml', 'json'] as const) {
          serializePolicyFile(value as SandboxPolicy, format);
          policyToText(value as SandboxPolicy, format);
        }
        hasGatewayMarks(value as SandboxPolicy);
      } catch (error) {
        throw new Error(`threw for ${shown}: ${(error as Error).stack}`);
      }
    }
  });
});
