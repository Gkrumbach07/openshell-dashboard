import {
  addEndpointOperation,
  addL7RuleOperation,
  canAppendL7Rules,
  emptyEndpoint,
  endpointFromForm,
  endpointPorts,
  endpointSummary,
  enumLabel,
  generatedRuleName,
  hasAllowBase,
  isProviderRuleName,
  isValidL7Path,
  l7MatchSummary,
  l7RuleTarget,
  otherEndpointFields,
  removeEndpointOperations,
  removeRuleOperation,
  splitRules,
} from '../utils';
import type { EndpointFormValues } from '../utils';
import type { NetworkEndpoint, NetworkPolicyRule } from '../../../types';

const form = (overrides: Partial<EndpointFormValues>): EndpointFormValues => ({
  ...emptyEndpoint,
  host: 'api.github.com',
  ...overrides,
});

describe('generatedRuleName', () => {
  // The same cases as openshell-policy's generated_rule_name: an endpoint
  // added here and one added by the CLI have to land on the same rule.
  it('names a rule the way the CLI does', () => {
    expect(generatedRuleName('api.github.com', 443)).toBe(
      'allow_api_github_com_443',
    );
    expect(generatedRuleName('my-host.example.com', 8443)).toBe(
      'allow_my_host_example_com_8443',
    );
    expect(generatedRuleName('*.example.com', 443)).toBe(
      'allow__example_com_443',
    );
  });
});

describe('endpointFromForm', () => {
  it('sends the port in both spellings, as --add-endpoint does', () => {
    expect(endpointFromForm(form({ port: 8443 }))).toEqual({
      host: 'api.github.com',
      port: 8443,
      ports: [8443],
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
    });
  });

  it('leaves access and enforcement off an endpoint that is not inspected', () => {
    // The gateway refuses both on "tcp"; neither means anything without a
    // protocol.
    expect(endpointFromForm(form({ protocol: 'tcp' }))).toEqual({
      host: 'api.github.com',
      port: 443,
      ports: [443],
      protocol: 'tcp',
    });
    expect(endpointFromForm(form({ protocol: '' }))).toEqual({
      host: 'api.github.com',
      port: 443,
      ports: [443],
    });
  });

  it('carries the endpoint options the CLI takes', () => {
    expect(
      endpointFromForm(
        form({
          host: '  realtime.example.com ',
          allowedIps: '10.0.0.0/8\n\n 172.16.0.0/12 \n10.0.0.0/8',
          allowUninspectedCredentials: true,
          websocketCredentialRewrite: true,
          requestBodyCredentialRewrite: true,
        }),
      ),
    ).toEqual({
      host: 'realtime.example.com',
      port: 443,
      ports: [443],
      protocol: 'rest',
      access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
      enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      allowedIps: ['10.0.0.0/8', '172.16.0.0/12'],
      allowUninspectedCredentials: true,
      websocketCredentialRewrite: true,
      requestBodyCredentialRewrite: true,
    });
  });

  it('drops a credential rewrite the protocol does not support', () => {
    // Left ticked from another protocol: the CLI refuses these combinations.
    const websocket = endpointFromForm(
      form({
        protocol: 'websocket',
        websocketCredentialRewrite: true,
        requestBodyCredentialRewrite: true,
      }),
    );
    expect(websocket.websocketCredentialRewrite).toBe(true);
    expect(websocket).not.toHaveProperty('requestBodyCredentialRewrite');

    const tcp = endpointFromForm(
      form({
        protocol: 'tcp',
        websocketCredentialRewrite: true,
        requestBodyCredentialRewrite: true,
      }),
    );
    expect(tcp).not.toHaveProperty('websocketCredentialRewrite');
    expect(tcp).not.toHaveProperty('requestBodyCredentialRewrite');
  });
});

describe('addEndpointOperation', () => {
  it('is one addRule holding the one endpoint, under the generated name', () => {
    expect(addEndpointOperation('', form({}))).toEqual({
      addRule: {
        ruleName: 'allow_api_github_com_443',
        rule: {
          name: 'allow_api_github_com_443',
          endpoints: [
            {
              host: 'api.github.com',
              port: 443,
              ports: [443],
              protocol: 'rest',
              access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
            },
          ],
        },
      },
    });
  });

  it('uses the given rule name and every binary, once each', () => {
    const operation = addEndpointOperation(
      ' github ',
      form({ binaryPaths: '/usr/bin/gh\n/usr/bin/git\n/usr/bin/gh\n' }),
    );
    expect(operation).toMatchObject({
      addRule: {
        ruleName: 'github',
        rule: {
          name: 'github',
          binaries: [{ path: '/usr/bin/gh' }, { path: '/usr/bin/git' }],
        },
      },
    });
  });

  it('names no binaries for an endpoint any process may reach', () => {
    // An empty list and an absent one are the same on the wire; absent is
    // what the form means.
    const operation = addEndpointOperation('', form({ binaryPaths: ' \n' }));
    expect('addRule' in operation && operation.addRule.rule).not.toHaveProperty(
      'binaries',
    );
  });
});

describe('removal operations', () => {
  it('removes a rule by name', () => {
    expect(removeRuleOperation('github')).toEqual({
      removeRule: { ruleName: 'github' },
    });
  });

  it('removes an endpoint one port at a time, which is how the gateway takes it', () => {
    expect(
      removeEndpointOperations('api', {
        host: 'api.example.com',
        port: 443,
        ports: [443, 8443],
      }),
    ).toEqual([
      {
        removeEndpoint: { ruleName: 'api', host: 'api.example.com', port: 443 },
      },
      {
        removeEndpoint: {
          ruleName: 'api',
          host: 'api.example.com',
          port: 8443,
        },
      },
    ]);
    expect(
      removeEndpointOperations('gh', { host: 'api.github.com', port: 443 }),
    ).toEqual([
      { removeEndpoint: { ruleName: 'gh', host: 'api.github.com', port: 443 } },
    ]);
  });
});

describe('endpointPorts', () => {
  it('prefers the port list, as the gateway does', () => {
    expect(endpointPorts({ port: 80, ports: [443, 8443] })).toEqual([
      443, 8443,
    ]);
    expect(endpointPorts({ port: 443 })).toEqual([443]);
    expect(endpointPorts({ ports: [] })).toEqual([]);
    expect(endpointPorts({})).toEqual([]);
  });
});

describe('L7 appends', () => {
  const endpoint: NetworkEndpoint = {
    host: 'api.example.com',
    port: 443,
    ports: [443, 8443],
    protocol: 'rest',
    path: '/v1/**',
    rules: [{ allow: { method: 'GET', path: '/v1/models/**' } }],
  };
  const rule: NetworkPolicyRule = {
    name: 'internal-api',
    endpoints: [endpoint],
    binaries: [{ path: '/usr/bin/curl' }, { path: '/usr/bin/python3' }],
  };

  it('declares the whole scope of the endpoint it appends to', () => {
    // Every port, the path scope and every binary: the gateway refuses an
    // append whose target leaves any of them out.
    expect(l7RuleTarget('api', rule, endpoint)).toEqual({
      ruleName: 'api',
      host: 'api.example.com',
      ports: [443, 8443],
      path: '/v1/**',
      binaries: [{ path: '/usr/bin/curl' }, { path: '/usr/bin/python3' }],
    });
  });

  it('says so when the rule allows any binary, and when the endpoint has no path', () => {
    const open: NetworkEndpoint = { host: 'docs.example.com', port: 443 };
    expect(l7RuleTarget('docs', { endpoints: [open] }, open)).toEqual({
      ruleName: 'docs',
      host: 'docs.example.com',
      ports: [443],
      // Present and empty: it selects the endpoint without a path scope.
      path: '',
      anyBinary: true,
    });
  });

  it('builds an allow and a deny append for the same target', () => {
    const target = l7RuleTarget('api', rule, endpoint);
    expect(
      addL7RuleOperation(
        'allow',
        'api',
        rule,
        endpoint,
        ' post ',
        ' /v1/chat/** ',
      ),
    ).toEqual({
      addAllowRules: {
        target,
        rules: [{ allow: { method: 'POST', path: '/v1/chat/**' } }],
      },
    });
    expect(
      addL7RuleOperation(
        'deny',
        'api',
        rule,
        endpoint,
        'DELETE',
        '/v1/models/**',
      ),
    ).toEqual({
      addDenyRules: {
        target,
        denyRules: [{ method: 'DELETE', path: '/v1/models/**' }],
      },
    });
  });

  it('knows which endpoints take request rules', () => {
    expect(canAppendL7Rules({ protocol: 'rest' })).toBe(true);
    expect(canAppendL7Rules({ protocol: 'websocket' })).toBe(true);
    expect(canAppendL7Rules({ protocol: 'mcp' })).toBe(false);
    expect(canAppendL7Rules({ protocol: 'tcp' })).toBe(false);
    expect(canAppendL7Rules({})).toBe(false);

    expect(hasAllowBase({ access: 'NETWORK_ACCESS_PRESET_READ_ONLY' })).toBe(
      true,
    );
    expect(hasAllowBase({ rules: [{ allow: { method: 'GET' } }] })).toBe(true);
    expect(hasAllowBase({ protocol: 'rest' })).toBe(false);
  });

  it('accepts the request paths the CLI accepts', () => {
    expect(isValidL7Path('/v1/**')).toBe(true);
    expect(isValidL7Path('**')).toBe(true);
    expect(isValidL7Path('**/admin')).toBe(true);
    expect(isValidL7Path('v1/**')).toBe(false);
    expect(isValidL7Path('')).toBe(false);
  });
});

describe('display helpers', () => {
  it('spells enum values the way the CLI and policy files do', () => {
    expect(enumLabel('NETWORK_ACCESS_PRESET_READ_ONLY')).toBe('read-only');
    expect(enumLabel('NETWORK_ENFORCEMENT_MODE_AUDIT')).toBe('audit');
    expect(enumLabel('NETWORK_TLS_MODE_SKIP')).toBe('skip');
    expect(enumLabel(undefined)).toBe('');
  });

  it('summarizes an endpoint with every port and its path scope', () => {
    expect(
      endpointSummary({
        host: 'api.example.com',
        port: 443,
        ports: [443, 8443],
        path: '/v1/**',
        protocol: 'rest',
        enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
      }),
    ).toBe('api.example.com:443,8443 /v1/** rest enforce');
    expect(endpointSummary({ host: 'ghcr.io', port: 443 })).toBe('ghcr.io:443');
  });

  it('names what a matcher constrains beyond method and path', () => {
    expect(l7MatchSummary({ method: 'GET', path: '/v1/**' })).toBe(
      'GET /v1/**',
    );
    expect(
      l7MatchSummary({
        method: 'POST',
        path: '/graphql',
        operationType: 'query',
        operationName: 'Viewer',
        fields: ['login'],
        query: { page: { glob: '1*' } },
        params: { name: { any: ['search'] } },
      }),
    ).toBe(
      'POST /graphql graphql query Viewer fields login query page params name',
    );
    expect(l7MatchSummary(undefined)).toBe('(empty)');
  });

  it('lists the endpoint fields a row does not show', () => {
    expect(
      otherEndpointFields({
        host: 'mcp.example.com',
        port: 443,
        protocol: 'mcp',
        rules: [],
        mcp: { versions: ['2025-06-18'] },
        allowEncodedSlash: true,
        credentialBinding: { provider: 'claude' },
      }),
    ).toEqual(['allowEncodedSlash', 'credentialBinding', 'mcp']);
  });
});

describe('provider rules', () => {
  it('recognises the reserved prefix and nothing that merely contains it', () => {
    expect(isProviderRuleName('_provider_work_github')).toBe(true);
    expect(isProviderRuleName('_provider_')).toBe(true);
    expect(isProviderRuleName('provider_work_github')).toBe(false);
    expect(isProviderRuleName('custom_provider_work_github')).toBe(false);
  });

  it("splits a policy's rules into the sandbox's own and the gateway's", () => {
    const own = { endpoints: [{ host: 'api.github.com', port: 443 }] };
    const composed = { endpoints: [{ host: 'api.anthropic.com', port: 443 }] };
    expect(splitRules({ gh: own, _provider_claude: composed })).toEqual({
      own: { gh: own },
      provider: { _provider_claude: composed },
    });
    expect(splitRules(undefined)).toEqual({ own: {}, provider: {} });
  });
});
