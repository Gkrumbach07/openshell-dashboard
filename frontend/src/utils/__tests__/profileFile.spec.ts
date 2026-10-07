import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

import {
  isProfileExportable,
  parseProfileFile,
  profileFileFormat,
  profileToDocument,
  serializeProfileFile,
} from '../profileFile';
import type { ImportProfileRequest, ProviderProfile } from '../../types';

const FIXTURES = join(__dirname, 'fixtures', 'provider-profiles');

const fixture = (path: string): string =>
  readFileSync(join(FIXTURES, path), 'utf8');

// The profile a file holds, which the test expects to be one.
const read = (
  text: string,
  format: 'yaml' | 'json' = 'yaml',
): ImportProfileRequest => {
  const parsed = parseProfileFile(text, format, 'test.yaml');
  if (!parsed.profile) {
    throw new Error(parsed.diagnostics.map((d) => d.message).join('; '));
  }
  return parsed.profile;
};

// The one error a file that is not a profile is refused with.
const refusal = (text: string, format: 'yaml' | 'json' = 'yaml'): string => {
  const parsed = parseProfileFile(text, format, 'test.yaml');
  expect(parsed.profile).toBeUndefined();
  expect(parsed.diagnostics).toHaveLength(1);
  expect(parsed.diagnostics[0]).toMatchObject({
    source: 'test.yaml',
    field: 'file',
    severity: 'error',
  });
  return parsed.diagnostics[0].message;
};

const MINIMAL = 'id: p\ndisplay_name: P\n';

// One credential, or one endpoint, of an otherwise minimal profile.
const withCredential = (yaml: string) =>
  read(`${MINIMAL}credentials:\n  - name: token\n${yaml}`).credentials?.[0];
const withEndpoint = (yaml: string) =>
  read(`${MINIMAL}endpoints:\n  - host: a.example\n${yaml}`)
    .networkEndpoints?.[0];

// --- Upstream's own profile files ---

// A profile document with what upstream reads the same way made the same:
// the older whole-seconds durations as duration strings, a field holding
// nothing the same as a field left out, and a profile that names no category
// in the category it gets. What is left differs only if a field or a value
// was lost or changed.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const [key, field] of Object.entries(source)) {
    const seconds = /^(.*)_seconds$/.exec(key);
    if (seconds) {
      if (field !== 0 && !(seconds[1] in source)) {
        out[seconds[1]] = `${field}s`;
      }
      continue;
    }
    const kept = canonical(field);
    const empty =
      kept === '' ||
      kept === false ||
      kept === 0 ||
      kept === null ||
      (typeof kept === 'object' && Object.keys(kept as object).length === 0);
    if (!empty) {
      out[key] = kept;
    }
  }
  return out;
};

const withDefaults = (document: Record<string, unknown>) => ({
  category: 'other',
  ...document,
});

describe('upstream provider profiles', () => {
  const published = readdirSync(join(FIXTURES, 'providers'))
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => `providers/${name}`);

  it('has the sixteen profiles upstream publishes at v0.1.2', () => {
    expect(published).toHaveLength(16);
  });

  it.each([...published, 'docs/profile-schema.yaml'])(
    '%s is read whole and written back whole',
    (path) => {
      const text = fixture(path);
      const parsed = parseProfileFile(text, 'yaml', path);
      // No error, and no field the schema does not have: every field these
      // files use is one the dashboard understands.
      expect(parsed.diagnostics).toEqual([]);
      const profile = parsed.profile as ImportProfileRequest;
      expect(profile.importSource).toBe(path);

      // File -> API -> file: the document that is written says what the
      // document that was read said.
      expect(canonical(profileToDocument(profile))).toEqual(
        canonical(withDefaults(parseYaml(text))),
      );

      // API -> file -> API, in both formats: nothing is lost on the way out
      // and back in either.
      for (const format of ['yaml', 'json'] as const) {
        const again = parseProfileFile(
          serializeProfileFile(profile, format),
          format,
          path,
        );
        expect(again.diagnostics).toEqual([]);
        expect(again.profile).toEqual(profile);
      }
    },
  );

  it('reads providers/github.yaml as the profile it is', () => {
    expect(read(fixture('providers/github.yaml'))).toEqual({
      id: 'github',
      displayName: 'GitHub',
      description: 'GitHub API and Git operations',
      category: 'SOURCE_CONTROL',
      inferenceCapable: false,
      importSource: 'test.yaml',
      credentials: [
        {
          name: 'api_token',
          description: 'GitHub token',
          envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
          required: true,
          authStyle: 'bearer',
          headerName: 'authorization',
        },
      ],
      discovery: { credentials: ['api_token'] },
      networkEndpoints: [
        {
          host: 'api.github.com',
          port: 443,
          protocol: 'rest',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
        },
        {
          host: 'api.github.com',
          port: 443,
          path: '/graphql',
          protocol: 'graphql',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
        },
        {
          host: 'github.com',
          port: 443,
          protocol: 'rest',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
          rules: [
            { allow: { method: 'GET', path: '**' } },
            { allow: { method: 'HEAD', path: '**' } },
            { allow: { method: 'OPTIONS', path: '**' } },
            { allow: { method: 'POST', path: '/**/git-upload-pack' } },
          ],
        },
      ],
      binaries: [
        { path: '/usr/bin/gh' },
        { path: '/usr/local/bin/gh' },
        { path: '/usr/bin/git' },
        { path: '/usr/local/bin/git' },
      ],
    });
  });

  it('reads the refresh of providers/aws.yaml, older durations included', () => {
    const profile = read(fixture('providers/aws.yaml'));
    const refresh = profile.credentials?.[0].refresh;
    expect(refresh).toMatchObject({
      strategy: 'AWS_STS_ASSUME_ROLE',
      // refresh_before_seconds: 300 and max_lifetime_seconds: 3600.
      refreshBefore: '300s',
      maxLifetime: '3600s',
      additionalOutputs: [
        { output: 'secret_access_key', credential: 'secret_access_key' },
        { output: 'session_token', credential: 'session_token' },
      ],
    });
    expect(refresh?.material).toHaveLength(7);
    expect(refresh?.material?.[0]).toEqual({
      name: 'role_arn',
      description: 'ARN of the IAM role to assume',
      required: true,
      secret: false,
    });
    expect(refresh?.material?.[5]).toMatchObject({
      name: 'aws_secret_access_key',
      secret: true,
    });
    // An endpointless profile has no endpoints to send.
    expect(profile.networkEndpoints).toBeUndefined();
  });

  it('reads every field of the schema from the documented field map', () => {
    const profile = read(fixture('docs/profile-schema.yaml'));
    expect(profile.resourceVersion).toBe(1);
    expect(profile.annotations).toEqual({ 'example.com/source': 'platform' });
    expect(profile.credentials?.[1]).toEqual({
      name: 'api_token',
      description: 'API access token',
      envVars: ['CUSTOM_API_TOKEN'],
      required: true,
      authStyle: 'bearer',
      headerName: 'authorization',
      queryParam: 'api_key',
      pathTemplate: '/v1/{credential}/resources',
      refresh: {
        strategy: 'OAUTH2_CLIENT_CREDENTIALS',
        tokenUrl: 'https://login.example.com/oauth2/token',
        scopes: ['api.read', 'api.write'],
        refreshBefore: '300s',
        maxLifetime: '3600s',
        material: [
          {
            name: 'client_id',
            description: 'OAuth client ID',
            required: true,
            secret: false,
          },
          {
            name: 'client_secret',
            description: 'OAuth client secret',
            required: true,
            secret: true,
          },
        ],
      },
      tokenGrant: {
        grantType: 'TOKEN_EXCHANGE',
        tokenEndpoint:
          'https://login.example.com/realms/custom/protocol/openid-connect/token',
        audience: 'api://custom-api',
        jwtSvidAudience: 'https://login.example.com/realms/custom',
        clientAssertionType:
          'urn:ietf:params:oauth:client-assertion-type:jwt-spiffe',
        scopes: ['api.read', 'api.write'],
        cacheTtl: '300s',
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        subjectToken: {
          source: 'provider_credential',
          credential: 'user_oidc_token',
          subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        },
        audienceOverrides: [
          {
            host: 'api.example.com',
            port: 443,
            path: '/v1/projects/**',
            audience: 'api://custom-projects',
            scopes: ['projects.read'],
          },
        ],
      },
    });
    expect(profile.networkEndpoints).toEqual([
      {
        host: 'api.example.com',
        port: 443,
        path: '/v1/**',
        protocol: 'rest',
        enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
        persistedQueries: 'deny',
        graphqlMaxBodyBytes: 65536,
        rules: [
          {
            allow: {
              method: 'GET',
              path: '/v1/projects/**',
              query: { tag: { any: ['prod-*', 'staging-*'] } },
            },
          },
        ],
        denyRules: [{ method: 'DELETE', path: '/v1/projects/**' }],
        graphqlPersistedQueries: {
          '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08': {
            operationType: 'query',
            operationName: 'GetProject',
            fields: ['project'],
          },
        },
      },
    ]);
  });

  // A profile file has to say which profile it is.
  it.each([
    'examples/governance-interceptor/profiles/github.yaml',
    'examples/governance-interceptor/profiles/slack.yaml',
  ])('%s has no id and is refused', (path) => {
    expect(refusal(fixture(path))).toBe(
      'failed to parse provider profile YAML: missing field `id`',
    );
  });

  // `tls: none` is not a TLS mode v0.1.2 has. It is sent on as the value no
  // mode has, for the gateway to refuse, which is what the CLI does with it;
  // it is not read as "no TLS setting".
  it.each([
    'examples/spiffe-token-exchange-demo/provider-profile.yaml',
    'examples/spiffe-token-grant-demo/provider-profile.yaml',
  ])('%s keeps its token grant, and its unknown TLS mode', (path) => {
    const parsed = parseProfileFile(fixture(path), 'yaml', path);
    expect(parsed.diagnostics).toEqual([]);
    const profile = parsed.profile as ImportProfileRequest;

    const grant = profile.credentials?.find((c) => c.tokenGrant)?.tokenGrant;
    expect(grant).toMatchObject({
      audience: 'demo-default',
      clientAssertionType:
        'urn:ietf:params:oauth:client-assertion-type:jwt-spiffe',
      scopes: ['demo'],
      // cache_ttl_seconds: 60.
      cacheTtl: '60s',
    });
    expect(grant?.audienceOverrides).toHaveLength(2);

    expect(profile.networkEndpoints?.map((e) => e.tls)).toEqual([-1, -1]);
    const written = profileToDocument(profile).endpoints as { tls: string }[];
    expect(written.map((e) => e.tls)).toEqual(['unknown(-1)', 'unknown(-1)']);

    // Everything else in the file survives being written out again.
    const original = canonical(withDefaults(parseYaml(fixture(path)))) as {
      endpoints: { tls?: string }[];
    };
    original.endpoints.forEach((endpoint) => {
      endpoint.tls = 'unknown(-1)';
    });
    expect(canonical(profileToDocument(profile))).toEqual(original);
  });

  it('reads a token exchange grant and its subject token', () => {
    const profile = read(
      fixture('examples/spiffe-token-exchange-demo/provider-profile.yaml'),
    );
    expect(profile.credentials?.[1].tokenGrant).toMatchObject({
      grantType: 'TOKEN_EXCHANGE',
      subjectToken: {
        source: 'provider_credential',
        credential: 'subject_token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      },
    });
  });
});

// --- The fields that are not plain data ---

describe('durations', () => {
  const refresh = (yaml: string) =>
    withCredential(`    refresh:\n      strategy: static\n${yaml}`)?.refresh;

  it('reads a duration string as it is', () => {
    expect(refresh('      refresh_before: "300s"')?.refreshBefore).toBe('300s');
    expect(refresh('      max_lifetime: 1.5s')?.maxLifetime).toBe('1.5s');
  });

  it('reads the older whole-seconds field as a duration', () => {
    expect(refresh('      refresh_before_seconds: 300')?.refreshBefore).toBe(
      '300s',
    );
  });

  it('takes the string when a file has both', () => {
    expect(
      refresh('      refresh_before_seconds: 300\n      refresh_before: 60s')
        ?.refreshBefore,
    ).toBe('60s');
  });

  // An absent refresh_before takes the gateway's default; "0s" refreshes at
  // expiry.
  it('keeps "0s" apart from no duration', () => {
    expect(refresh('      refresh_before: 0s')?.refreshBefore).toBe('0s');
    expect(refresh('      token_url: https://x')).not.toHaveProperty(
      'refreshBefore',
    );
    // Zero seconds in the older field is how that field says "not set".
    expect(refresh('      refresh_before_seconds: 0')).not.toHaveProperty(
      'refreshBefore',
    );
  });

  it('writes the string and never the older field', () => {
    const profile = read(
      `${MINIMAL}credentials:\n  - name: token\n    refresh:\n      strategy: static\n      refresh_before_seconds: 300\n      max_lifetime: 0s\n`,
    );
    expect(profileToDocument(profile).credentials).toEqual([
      expect.objectContaining({
        refresh: {
          strategy: 'static',
          refresh_before: '300s',
          max_lifetime: '0s',
        },
      }),
    ]);
  });

  it('reads a token grant cache lifetime the same way', () => {
    const grant = (yaml: string) =>
      withCredential(
        `    token_grant:\n      token_endpoint: https://x\n${yaml}`,
      )?.tokenGrant;
    expect(grant('      cache_ttl: 90s')?.cacheTtl).toBe('90s');
    expect(grant('      cache_ttl_seconds: 60')?.cacheTtl).toBe('60s');
    expect(grant('      audience: a')).not.toHaveProperty('cacheTtl');
  });

  it.each(['5m', '300', 's', '1.s', '1.0000000001s'])(
    'refuses %s, which is not a duration',
    (text) => {
      expect(
        refusal(
          `${MINIMAL}credentials:\n  - name: token\n    refresh:\n      refresh_before: "${text}"\n`,
        ),
      ).toContain(
        `credentials[0].refresh.refresh_before: invalid duration "${text}"`,
      );
    },
  );

  it('refuses a number where a duration string goes', () => {
    expect(
      refusal(
        `${MINIMAL}credentials:\n  - name: token\n    refresh:\n      refresh_before: 300\n`,
      ),
    ).toContain(
      'credentials[0].refresh.refresh_before: invalid type: number `300`, expected a string',
    );
  });
});

describe('enum names', () => {
  it.each([
    ['source_control', 'SOURCE_CONTROL'],
    ['Source-Control', 'SOURCE_CONTROL'],
    [' INFERENCE ', 'INFERENCE'],
    ['other', 'OTHER'],
    ['""', 'OTHER'],
  ])('reads category %s as %s', (name, category) => {
    expect(read(`${MINIMAL}category: ${name}\n`).category).toBe(category);
  });

  it('gives a profile that names no category the category other', () => {
    expect(read(MINIMAL).category).toBe('OTHER');
    expect(profileToDocument(read(MINIMAL)).category).toBe('other');
  });

  it('refuses a category that is none', () => {
    expect(refusal(`${MINIMAL}category: tooling\n`)).toContain(
      'category: unsupported provider profile category: tooling',
    );
  });

  it.each([
    ['static', 'STATIC'],
    ['external', 'EXTERNAL'],
    ['oauth2_refresh_token', 'OAUTH2_REFRESH_TOKEN'],
    ['OAuth2-Client-Credentials', 'OAUTH2_CLIENT_CREDENTIALS'],
    ['google_service_account_jwt', 'GOOGLE_SERVICE_ACCOUNT_JWT'],
    ['aws_sts_assume_role', 'AWS_STS_ASSUME_ROLE'],
  ])('reads refresh strategy %s as %s and writes it back', (name, strategy) => {
    const credential = withCredential(
      `    refresh:\n      strategy: ${name}\n`,
    );
    expect(credential?.refresh?.strategy).toBe(strategy);
    const written = profileToDocument({
      ...read(MINIMAL),
      credentials: credential ? [credential] : [],
    }).credentials as { refresh: { strategy: string } }[];
    expect(written[0].refresh.strategy).toBe(
      name.toLowerCase().replace(/-/g, '_'),
    );
  });

  it('reads a refresh that names no strategy as unspecified', () => {
    expect(
      withCredential('    refresh:\n      token_url: https://x\n')?.refresh
        ?.strategy,
    ).toBe('UNSPECIFIED');
  });

  it('refuses a refresh strategy that is none', () => {
    expect(
      refusal(
        `${MINIMAL}credentials:\n  - name: token\n    refresh:\n      strategy: oauth3\n`,
      ),
    ).toContain(
      'credentials[0].refresh.strategy: unsupported provider refresh strategy: oauth3',
    );
  });

  it('reads a token grant that names no type as client credentials', () => {
    const grant = (yaml: string) =>
      withCredential(
        `    token_grant:\n      token_endpoint: https://x\n${yaml}`,
      )?.tokenGrant;
    expect(grant('')?.grantType).toBe('CLIENT_CREDENTIALS');
    expect(grant('      grant_type: client_credentials')?.grantType).toBe(
      'CLIENT_CREDENTIALS',
    );
    expect(grant('      grant_type: Token-Exchange')?.grantType).toBe(
      'TOKEN_EXCHANGE',
    );
  });

  // client_credentials is what a grant without a type means, so upstream
  // leaves it out of the file.
  it('writes a grant type only when it is not the default', () => {
    const written = (grantType: string) =>
      profileToDocument({
        ...read(MINIMAL),
        credentials: [
          {
            name: 'token',
            required: false,
            tokenGrant: { grantType, tokenEndpoint: 'https://x' },
          },
        ],
      }).credentials as { token_grant: Record<string, string> }[];
    expect(written('TOKEN_EXCHANGE')[0].token_grant).toEqual({
      grant_type: 'token_exchange',
      token_endpoint: 'https://x',
    });
    for (const grantType of ['CLIENT_CREDENTIALS', 'UNSPECIFIED']) {
      expect(written(grantType)[0].token_grant).toEqual({
        token_endpoint: 'https://x',
      });
    }
  });

  it('refuses a grant type that is none', () => {
    expect(
      refusal(
        `${MINIMAL}credentials:\n  - name: token\n    token_grant:\n      token_endpoint: https://x\n      grant_type: password\n`,
      ),
    ).toContain('unsupported provider token grant type: password');
  });
});

describe('endpoint modes', () => {
  it.each([
    ['tls', 'skip', 'NETWORK_TLS_MODE_SKIP'],
    ['tls', 'terminate', 'NETWORK_TLS_MODE_TERMINATE'],
    ['tls', 'passthrough', 'NETWORK_TLS_MODE_PASSTHROUGH'],
    ['access', 'read-only', 'NETWORK_ACCESS_PRESET_READ_ONLY'],
    ['access', 'read-write', 'NETWORK_ACCESS_PRESET_READ_WRITE'],
    ['access', 'full', 'NETWORK_ACCESS_PRESET_FULL'],
    ['enforcement', 'enforce', 'NETWORK_ENFORCEMENT_MODE_ENFORCE'],
    ['enforcement', 'audit', 'NETWORK_ENFORCEMENT_MODE_AUDIT'],
  ] as const)('reads %s: %s as %s and writes it back', (field, name, value) => {
    const endpoint = withEndpoint(`    ${field}: ${name}\n`);
    expect(endpoint?.[field]).toBe(value);
    const written = profileToDocument({
      ...read(MINIMAL),
      networkEndpoints: endpoint ? [endpoint] : [],
    }).endpoints as Record<string, string>[];
    expect(written[0][field]).toBe(name);
  });

  it('leaves a mode that is not set out of what is sent and written', () => {
    const endpoint = withEndpoint('    tls: ""\n    port: 443\n');
    expect(endpoint).toEqual({ host: 'a.example', port: 443 });
    expect(
      profileToDocument({ ...read(MINIMAL), networkEndpoints: [endpoint!] })
        .endpoints,
    ).toEqual([{ host: 'a.example', port: 443 }]);
  });

  // The names are matched as written: unlike a category, `Enforce` is not
  // `enforce` upstream.
  it.each([
    ['tls', 'none'],
    ['access', 'readonly'],
    ['enforcement', 'Enforce'],
  ] as const)(
    'sends %s: %s on as an unknown value for the gateway to refuse',
    (field, name) => {
      const endpoint = withEndpoint(`    ${field}: ${name}\n`);
      expect(endpoint?.[field]).toBe(-1);
    },
  );

  it('writes a value it has no name for the way upstream does', () => {
    const written = profileToDocument({
      ...read(MINIMAL),
      networkEndpoints: [{ host: 'a.example', access: 9, tls: -1 }],
    }).endpoints as Record<string, string>[];
    expect(written[0]).toMatchObject({
      access: 'unknown(9)',
      tls: 'unknown(-1)',
    });
  });
});

describe('matchers, binaries and rules', () => {
  it('reads a bare string matcher as its glob', () => {
    const endpoint = withEndpoint(
      '    rules:\n      - allow:\n          method: GET\n          query:\n            ref: "release-*"\n            tag:\n              any: [a, b]\n',
    );
    expect(endpoint?.rules).toEqual([
      {
        allow: {
          method: 'GET',
          query: { ref: { glob: 'release-*' }, tag: { any: ['a', 'b'] } },
        },
      },
    ]);
  });

  it('reads a binary written bare or as a path', () => {
    expect(
      read(`${MINIMAL}binaries:\n  - /usr/bin/gh\n  - path: /usr/bin/git\n`)
        .binaries,
    ).toEqual([{ path: '/usr/bin/gh' }, { path: '/usr/bin/git' }]);
  });

  it('writes binaries bare', () => {
    expect(
      profileToDocument({
        ...read(MINIMAL),
        binaries: [{ path: '/usr/bin/gh' }],
      }).binaries,
    ).toEqual(['/usr/bin/gh']);
  });

  it('refuses a binary with anything but a path', () => {
    expect(
      refusal(
        `${MINIMAL}binaries:\n  - path: /usr/bin/gh\n    harness: true\n    extra: 1\n`,
      ),
    ).toContain(
      "binaries[0]: unsupported provider profile binary fields: extra, harness; binaries accept only 'path' and the deprecated 'harness' field was removed in 0.1.0",
    );
  });

  // The API cannot say "an empty list", and an empty rule list does not mean
  // what a missing one means: it denies everything.
  it('refuses an empty rule list instead of sending it as no list', () => {
    expect(
      refusal(`${MINIMAL}endpoints:\n  - host: a.example\n    rules: []\n`),
    ).toContain(
      'endpoints[0]: rules list cannot be empty (would deny all traffic). Use `access: full` or remove rules.',
    );
    expect(
      refusal(
        `${MINIMAL}endpoints:\n  - host: a.example\n    deny_rules: []\n`,
      ),
    ).toContain(
      'endpoints[0]: deny_rules list cannot be empty (would have no effect). Remove it if no denials are needed.',
    );
  });

  it('reads no rule list as no rules', () => {
    const endpoint = withEndpoint('    port: 443\n    rules: null\n');
    expect(endpoint).toEqual({ host: 'a.example', port: 443 });
  });

  it('keeps a rule that allows nothing in particular', () => {
    expect(withEndpoint('    rules:\n      - {}\n')?.rules).toEqual([{}]);
  });
});

describe('MCP endpoints', () => {
  const mcp = (yaml: string) =>
    `${MINIMAL}endpoints:\n  - host: mcp.example\n    protocol: mcp\n${yaml}`;

  it('reads a tool as the name parameter of its rule', () => {
    const profile = read(
      mcp(
        '    rules:\n      - allow:\n          method: tools/call\n          tool: "search_*"\n    deny_rules:\n      - method: tools/call\n        tool:\n          any: [delete_repo]\n',
      ),
    );
    expect(profile.networkEndpoints?.[0]).toMatchObject({
      rules: [
        {
          allow: {
            method: 'tools/call',
            params: { name: { glob: 'search_*' } },
          },
        },
      ],
      denyRules: [
        { method: 'tools/call', params: { name: { any: ['delete_repo'] } } },
      ],
    });
  });

  it('refuses a rule that names its tool twice', () => {
    expect(
      refusal(
        mcp(
          '    rules:\n      - allow:\n          tool: a\n          params:\n            name: b\n',
        ),
      ),
    ).toContain(
      'endpoints[0].rules[0].allow: MCP rules must use either tool or params.name, not both',
    );
    expect(
      refusal(
        mcp(
          '    deny_rules:\n      - tool: a\n        params:\n          name: b\n',
        ),
      ),
    ).toContain(
      'endpoints[0].deny_rules[0]: MCP rules must use either tool or params.name, not both',
    );
  });

  // Elsewhere the two are not a contradiction the profile check knows about,
  // and the parameter that is there stays.
  it('keeps params.name over tool on an endpoint that is not MCP', () => {
    const endpoint = withEndpoint(
      '    protocol: json-rpc\n    rules:\n      - allow:\n          tool: a\n          params:\n            name: b\n',
    );
    expect(endpoint?.rules?.[0].allow?.params).toEqual({ name: { glob: 'b' } });
  });

  it('reads the options, and keeps unset apart from false', () => {
    const options = (yaml: string) => read(mcp(yaml)).networkEndpoints?.[0].mcp;
    expect(
      options(
        '    mcp:\n      versions: ["2025-06-18", "2025-11-25"]\n      strict_tool_names: false\n',
      ),
    ).toEqual({
      versions: ['2025-06-18', '2025-11-25'],
      strictToolNames: false,
    });
    expect(
      options('    mcp:\n      allow_all_known_mcp_methods: true\n'),
    ).toEqual({ allowAllKnownMcpMethods: true });
  });

  // Which revision an endpoint gets when it names none is the gateway's to
  // say, so none is sent and none is made up.
  it('sends an endpoint that names no revision as it is written', () => {
    expect(read(mcp('')).networkEndpoints?.[0]).toEqual({
      host: 'mcp.example',
      protocol: 'mcp',
    });
    expect(read(mcp('    mcp: {}\n')).networkEndpoints?.[0]).toEqual({
      host: 'mcp.example',
      protocol: 'mcp',
      mcp: {},
    });
  });

  it('writes the options back, false included', () => {
    const written = profileToDocument({
      ...read(MINIMAL),
      networkEndpoints: [
        {
          host: 'mcp.example',
          protocol: 'mcp',
          mcp: { versions: ['2025-11-25'], strictToolNames: false },
        },
      ],
    }).endpoints;
    expect(written).toEqual([
      {
        host: 'mcp.example',
        protocol: 'mcp',
        mcp: { versions: ['2025-11-25'], strict_tool_names: false },
      },
    ]);
  });

  it.each([
    ['    mcp: null\n', 'endpoints[0].mcp: mcp must be an object when present'],
    [
      '    mcp:\n      versions: []\n',
      'endpoints[0].mcp.versions: mcp.versions must contain at least one supported protocol version',
    ],
    [
      '    mcp:\n      versions: ["2025-11-25", "2025-11-25"]\n',
      "endpoints[0].mcp.versions: duplicate MCP protocol version '2025-11-25'",
    ],
    [
      '    mcp:\n      version: "2025-11-25"\n',
      'endpoints[0].mcp: unknown field `version`',
    ],
  ])('refuses %j', (yaml, message) => {
    expect(refusal(mcp(yaml))).toContain(message);
  });
});

describe('reading a file', () => {
  it('reads JSON as it reads YAML', () => {
    const yaml = fixture('providers/github.yaml');
    const json = JSON.stringify(parseYaml(yaml));
    expect(read(json, 'json')).toEqual(read(yaml));
  });

  it('names the file in the profile and in what it reports', () => {
    const parsed = parseProfileFile(MINIMAL, 'yaml', 'profiles/p.yaml');
    expect(parsed.profile?.importSource).toBe('profiles/p.yaml');
  });

  // serde skips a field it does not know, silently. A misspelt field is a
  // profile that says less than its author thinks, so here it is said.
  it('reports a field the schema does not have, and still reads the profile', () => {
    const parsed = parseProfileFile(
      `${MINIMAL}displayname: typo\nendpoints:\n  - host: a.example\n    enforcment: enforce\ncredentials:\n  - name: token\n    refresh:\n      strategy: static\n      tokenUrl: https://x\n`,
      'yaml',
      'p.yaml',
    );
    expect(parsed.profile?.id).toBe('p');
    expect(parsed.diagnostics).toEqual(
      [
        'credentials[0].refresh.tokenUrl',
        'endpoints[0].enforcment',
        'displayname',
      ].map((field) => ({
        source: 'p.yaml',
        profileId: 'p',
        field: 'file',
        severity: 'warning',
        message: `unknown field \`${field}\` is not part of a provider profile and is ignored`,
      })),
    );
  });

  it.each([
    ['display_name: P\n', 'missing field `id`'],
    ['id: p\n', 'missing field `display_name`'],
    [
      `${MINIMAL}credentials:\n  - description: x\n`,
      'credentials[0]: missing field `name`',
    ],
    [
      `${MINIMAL}endpoints:\n  - port: 443\n`,
      'endpoints[0]: missing field `host`',
    ],
    [
      `${MINIMAL}credentials:\n  - name: t\n    token_grant:\n      audience: a\n`,
      'credentials[0].token_grant: missing field `token_endpoint`',
    ],
    [
      `${MINIMAL}description: 5\n`,
      'description: invalid type: number `5`, expected a string',
    ],
    [
      `${MINIMAL}description:\n`,
      'description: invalid type: null, expected a string',
    ],
    [
      `${MINIMAL}credentials: {}\n`,
      'credentials: invalid type: a mapping, expected a list',
    ],
    [
      `${MINIMAL}inference_capable: "yes"\n`,
      'inference_capable: invalid type: string `yes`, expected a boolean',
    ],
    [
      `${MINIMAL}endpoints:\n  - host: a\n    port: -1\n`,
      'endpoints[0].port: invalid type: number `-1`, expected a port number',
    ],
    [
      `${MINIMAL}endpoints:\n  - host: a\n    ports: [443, "x"]\n`,
      'endpoints[0].ports[1]: invalid type: string `x`, expected a port number',
    ],
    ['- id: p\n', 'invalid type: a list, expected a mapping'],
    ['just text', 'invalid type: string `just text`, expected a mapping'],
  ])('refuses %j', (text, message) => {
    expect(refusal(text)).toBe(
      `failed to parse provider profile YAML: ${message}`,
    );
  });

  it('refuses text that is not YAML or not JSON', () => {
    expect(refusal('id: [unclosed\n')).toMatch(
      /^failed to parse provider profile YAML: /,
    );
    expect(refusal('{"id": "p",', 'json')).toMatch(
      /^failed to parse provider profile JSON: /,
    );
  });

  // YAML 1.2, as upstream reads it: none of these is anything but text.
  it('reads dates and yes/no as the text they are', () => {
    const profile = read(
      `${MINIMAL}annotations:\n  reviewed: 2025-11-25\n  approved: yes\n`,
    );
    expect(profile.annotations).toEqual({
      reviewed: '2025-11-25',
      approved: 'yes',
    });
  });

  // A merge key copies the fields of an anchored mapping into another one.
  // It is not applied here, and a file that uses one would be read as a
  // profile with fewer fields than it appears to give: the second credential
  // below without its environment variable. Nothing may be imported that way,
  // so it is an error, not a field that is skipped with a warning.
  describe('a YAML merge key', () => {
    const merged = [
      MINIMAL.trimEnd(),
      'credentials:',
      '  - &base',
      '    name: token',
      '    env_vars: [TOKEN]',
      '    required: true',
      '  - <<: *base',
      '    name: second',
      '',
    ].join('\n');

    it('is refused, with where it is', () => {
      const message = refusal(merged);
      expect(message).toMatch(/^failed to parse provider profile YAML: /);
      expect(message).toContain('merge keys (`<<`) are not supported');
      // The eighth line of the file: `  - <<: *base`.
      expect(message).toContain('line 8, column 5');
    });

    it('is refused wherever it is written', () => {
      expect(
        refusal(
          `defaults: &defaults\n  category: data\n<<: *defaults\n${MINIMAL}`,
        ),
      ).toContain('merge keys (`<<`) are not supported');
      expect(
        refusal(
          `${MINIMAL}endpoints:\n  - &e\n    host: a.example\n    port: 443\n  - {<<: *e, host: b.example}\n`,
        ),
      ).toContain('merge keys (`<<`) are not supported');
    });

    // An anchor that is used whole is not a merge: the alias is the mapping.
    it('is not an alias', () => {
      const profile = read(
        `${MINIMAL}credentials:\n  - &base\n    name: token\n    env_vars: [TOKEN]\nannotations:\n  a: &text same\n  b: *text\n`,
      );
      expect(profile.annotations).toEqual({ a: 'same', b: 'same' });
    });

    // Quoted, "<<" is text like any other, and a key where keys are the
    // author's own. JSON has no merge keys at all.
    it('is not a key that is written as text', () => {
      expect(
        read(`${MINIMAL}annotations:\n  "<<": kept\n`).annotations,
      ).toEqual({ '<<': 'kept' });
      expect(
        read(
          JSON.stringify({
            id: 'p',
            display_name: 'P',
            annotations: { '<<': 'kept' },
          }),
          'json',
        ).annotations,
      ).toEqual({ '<<': 'kept' });
    });
  });

  // A key of a map is any text the author chose. "__proto__" is one like any
  // other to upstream, and has to stay a key here: assigning it to a plain
  // object sets the object's prototype and the entry is gone without a word.
  describe('a map key named "__proto__"', () => {
    const yaml = [
      MINIMAL.trimEnd(),
      'annotations:',
      '  __proto__: kept',
      '  owner: data-team',
      'endpoints:',
      '  - host: a.example',
      '    port: 443',
      '    protocol: graphql',
      '    graphql_persisted_queries:',
      '      __proto__:',
      '        operation_name: Viewer',
      '    rules:',
      '      - allow:',
      '          method: GET',
      '          query:',
      '            __proto__: "v*"',
      '            page: "1"',
      '          params:',
      '            __proto__:',
      '              any: [a, b]',
      '',
    ].join('\n');

    const ownKeys = (value: unknown): string[] =>
      Object.keys((value ?? {}) as object).sort();

    it.each([
      ['YAML', yaml, 'yaml'],
      ['JSON', JSON.stringify(parseYaml(yaml)), 'json'],
    ] as const)('is read as a key from %s', (_name, text, format) => {
      const parsed = parseProfileFile(text, format, 'test.yaml');
      expect(parsed.diagnostics).toEqual([]);
      const profile = parsed.profile;
      const endpoint = profile?.networkEndpoints?.[0];
      const allow = endpoint?.rules?.[0].allow;

      expect(ownKeys(profile?.annotations)).toEqual(['__proto__', 'owner']);
      expect(ownKeys(endpoint?.graphqlPersistedQueries)).toEqual(['__proto__']);
      expect(ownKeys(allow?.query)).toEqual(['__proto__', 'page']);
      expect(ownKeys(allow?.params)).toEqual(['__proto__']);
      // What is sent to the BFF carries every one of them.
      const sent = JSON.stringify(profile);
      expect(sent).toContain('"annotations":{"__proto__":"kept"');
      expect(sent).toContain(
        '"graphqlPersistedQueries":{"__proto__":{"operationName":"Viewer"}}',
      );
      expect(sent).toContain('"query":{"__proto__":{"glob":"v*"}');
      expect(sent).toContain('"params":{"__proto__":{"any":["a","b"]}}');
    });

    it('is written back as a key', () => {
      // As the BFF returns it: JSON, in which "__proto__" is a key.
      const stored = JSON.parse(JSON.stringify(read(yaml))) as ProviderProfile;
      const document = parseYaml(serializeProfileFile(stored, 'yaml')) as {
        annotations: object;
        endpoints: {
          graphql_persisted_queries: object;
          rules: { allow: { query: object; params: object } }[];
        }[];
      };
      const endpoint = document.endpoints[0];

      expect(ownKeys(document.annotations)).toEqual(['__proto__', 'owner']);
      expect(ownKeys(endpoint.graphql_persisted_queries)).toEqual([
        '__proto__',
      ]);
      expect(ownKeys(endpoint.rules[0].allow.query)).toEqual([
        '__proto__',
        'page',
      ]);
      expect(ownKeys(endpoint.rules[0].allow.params)).toEqual(['__proto__']);
      expect(serializeProfileFile(stored, 'json')).toContain(
        '"__proto__": "kept"',
      );
    });
  });

  it.each([
    ['github.yaml', 'yaml'],
    ['github.yml', 'yaml'],
    ['dir/github.json', 'json'],
    ['github.toml', undefined],
    ['github', undefined],
    ['.yaml/github', undefined],
  ])('reads %s as %s', (name, format) => {
    expect(profileFileFormat(name)).toBe(format);
  });
});

describe('writing a file', () => {
  const stored: ProviderProfile = {
    id: 'custom',
    displayName: 'Custom',
    category: 'DATA',
    credentials: [{ name: 'api_key', required: true }],
    inferenceCapable: false,
    resourceVersion: 4,
    source: 'user',
    scope: 'workspace',
    annotations: { 'example.com/owner': 'data-team' },
    endpoints: ['api.example.com:443'],
    networkEndpoints: [{ host: 'api.example.com', port: 443 }],
  };

  // The order upstream writes a profile in, and the fields it writes even
  // when they hold nothing.
  it('writes the fields upstream writes, in its order', () => {
    expect(serializeProfileFile(stored, 'yaml')).toBe(
      [
        'id: custom',
        'resource_version: 4',
        'annotations:',
        '  example.com/owner: data-team',
        'display_name: Custom',
        'description: ""',
        'category: data',
        'credentials:',
        '  - name: api_key',
        '    description: ""',
        '    env_vars: []',
        '    required: true',
        '    auth_style: ""',
        '    header_name: ""',
        '    query_param: ""',
        'endpoints:',
        '  - host: api.example.com',
        '    port: 443',
        'binaries: []',
        'inference_capable: false',
        'source: user',
        'scope: workspace',
        '',
      ].join('\n'),
    );
  });

  // The resource version is what lets the file be sent back as an update.
  it('writes JSON with the resource version, and reads it back', () => {
    const text = serializeProfileFile(stored, 'json');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({
      id: 'custom',
      resource_version: 4,
    });
    expect(read(text, 'json')).toMatchObject({
      id: 'custom',
      resourceVersion: 4,
      source: 'user',
      scope: 'workspace',
      networkEndpoints: [{ host: 'api.example.com', port: 443 }],
    });
  });

  it('quotes what YAML would read as something else', () => {
    const text = serializeProfileFile(
      {
        ...stored,
        annotations: { reviewed: 'true', count: '12', glob: '**' },
        description: 'a: b # not a comment',
      },
      'yaml',
    );
    expect(read(text)).toMatchObject({
      annotations: { reviewed: 'true', count: '12', glob: '**' },
      description: 'a: b # not a comment',
    });
  });

  it('does not fold a long value across lines', () => {
    const url = `https://login.example.com/${'realm/'.repeat(30)}token`;
    const text = serializeProfileFile(
      {
        ...stored,
        credentials: [
          {
            name: 'token',
            required: false,
            tokenGrant: { grantType: 'CLIENT_CREDENTIALS', tokenEndpoint: url },
          },
        ],
      },
      'yaml',
    );
    expect(text).toContain(`token_endpoint: ${url}\n`);
  });

  // A backend that reads profiles through the SDK returns the summaries and
  // not the endpoints. Exporting that would write a profile whose endpoints
  // are gone.
  it('says a profile whose endpoints it does not have whole is not exportable', () => {
    expect(isProfileExportable(stored)).toBe(true);
    expect(
      isProfileExportable({ ...stored, networkEndpoints: undefined }),
    ).toBe(false);
    expect(
      isProfileExportable({
        ...stored,
        endpoints: undefined,
        networkEndpoints: undefined,
      }),
    ).toBe(true);
  });
});
