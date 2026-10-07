import type {
  L7Allow,
  L7RuleTarget,
  NetworkBinary,
  NetworkEndpoint,
  NetworkPolicyRule,
  PolicyMergeOperation,
} from '../../types';

// The rule editor changes a policy the way `openshell policy update` does: it
// sends the gateway an operation and the gateway does the merge. The helpers
// here build those operations from what the user picked. None of them takes
// the policy as input, so there is no copy of it to get wrong on the way back.

// The reserved key prefix of the rules the gateway composes into the
// effective policy for attached providers (openshell-policy compose.rs). They
// are not part of the sandbox's own policy and cannot be written.
export const PROVIDER_RULE_PREFIX = '_provider_';

export const isProviderRuleName = (name: string): boolean =>
  name.startsWith(PROVIDER_RULE_PREFIX);

// What `--add-endpoint` takes for a protocol. An empty protocol and "tcp" are
// both L4 only; the gateway refuses access presets and enforcement on "tcp".
// The other protocols the gateway knows (graphql, json-rpc, mcp) need explicit
// rules, which a policy document carries and this form does not.
export const ENDPOINT_PROTOCOLS = [
  { value: 'rest', label: 'REST' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'sql', label: 'SQL (audit only)' },
  { value: 'tcp', label: 'TCP (L4 only)' },
  { value: '', label: 'None (L4 only)' },
] as const;

export type EndpointFormValues = {
  host: string;
  port: number;
  access: string;
  protocol: string;
  enforcement: string;
  // One path per line; none means any binary.
  binaryPaths: string;
  // One IP or CIDR per line.
  allowedIps: string;
  allowUninspectedCredentials: boolean;
  websocketCredentialRewrite: boolean;
  requestBodyCredentialRewrite: boolean;
};

export const emptyEndpoint: EndpointFormValues = {
  host: '',
  port: 443,
  access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
  protocol: 'rest',
  enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
  binaryPaths: '',
  allowedIps: '',
  allowUninspectedCredentials: false,
  websocketCredentialRewrite: false,
  requestBodyCredentialRewrite: false,
};

// An L7 protocol is inspected, so access presets and enforcement apply to it.
export const isL7Protocol = (protocol: string): boolean =>
  protocol !== '' && protocol !== 'tcp';

export const supportsWebsocketCredentialRewrite = (protocol: string): boolean =>
  protocol === 'rest' || protocol === 'websocket';

export const supportsRequestBodyCredentialRewrite = (
  protocol: string,
): boolean => protocol === 'rest';

const uniqueLines = (text: string): string[] => {
  const seen = new Set<string>();
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => seen.add(line));
  return [...seen];
};

// The rule name the CLI gives an endpoint added without --rule-name
// (openshell-policy generated_rule_name), so the same endpoint lands on the
// same rule whichever client adds it.
export const generatedRuleName = (host: string, port: number): string => {
  const sanitized = host.replace(/[.-]/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
  return `allow_${sanitized}_${port}`;
};

// The endpoint `--add-endpoint host:port:access:protocol:enforcement:options`
// describes. Fields the chosen protocol does not take are left out rather than
// sent for the gateway to refuse.
export const endpointFromForm = (form: EndpointFormValues): NetworkEndpoint => {
  const endpoint: NetworkEndpoint = {
    host: form.host.trim(),
    port: form.port,
    ports: [form.port],
  };
  if (form.protocol) {
    endpoint.protocol = form.protocol;
  }
  if (isL7Protocol(form.protocol)) {
    if (form.access) endpoint.access = form.access;
    if (form.enforcement) endpoint.enforcement = form.enforcement;
  }
  const allowedIps = uniqueLines(form.allowedIps);
  if (allowedIps.length > 0) {
    endpoint.allowedIps = allowedIps;
  }
  if (form.allowUninspectedCredentials) {
    endpoint.allowUninspectedCredentials = true;
  }
  if (
    form.websocketCredentialRewrite &&
    supportsWebsocketCredentialRewrite(form.protocol)
  ) {
    endpoint.websocketCredentialRewrite = true;
  }
  if (
    form.requestBodyCredentialRewrite &&
    supportsRequestBodyCredentialRewrite(form.protocol)
  ) {
    endpoint.requestBodyCredentialRewrite = true;
  }
  return endpoint;
};

// `policy update --add-endpoint ... [--binary ...] [--rule-name ...]`.
export const addEndpointOperation = (
  ruleName: string,
  form: EndpointFormValues,
): PolicyMergeOperation => {
  const endpoint = endpointFromForm(form);
  const resolvedName =
    ruleName.trim() || generatedRuleName(endpoint.host ?? '', form.port);
  const binaries = uniqueLines(form.binaryPaths).map((path) => ({ path }));
  const rule: NetworkPolicyRule = {
    name: resolvedName,
    endpoints: [endpoint],
  };
  if (binaries.length > 0) {
    rule.binaries = binaries;
  }
  return { addRule: { ruleName: resolvedName, rule } };
};

// `policy update --remove-rule <name>`.
export const removeRuleOperation = (
  ruleName: string,
): PolicyMergeOperation => ({
  removeRule: { ruleName },
});

// Every port an endpoint covers. `ports` wins over the single `port` when both
// are set, as it does on the gateway.
export const endpointPorts = (endpoint: NetworkEndpoint): number[] => {
  if (endpoint.ports?.length) return endpoint.ports;
  return endpoint.port ? [endpoint.port] : [];
};

// `policy update --remove-endpoint host:port`, once per port: the gateway
// removes one port at a time and drops the endpoint when none is left, and the
// rule when no endpoint is. It matches on host and port alone, so an endpoint
// of the same rule that differs only in its path scope loses the port too:
// see endpointRemovalEffect, which says what a removal takes with it.
export const removeEndpointOperations = (
  ruleName: string,
  endpoint: NetworkEndpoint,
): PolicyMergeOperation[] =>
  endpointPorts(endpoint).map((port) => ({
    removeEndpoint: { ruleName, host: endpoint.host ?? '', port },
  }));

// What removing an endpoint does to one endpoint of its rule.
export type AffectedEndpoint = {
  // The endpoint as the rule holds it now, and where in the rule it is.
  endpoint: NetworkEndpoint;
  index: number;
  // The ports it loses. When it keeps none it is removed altogether.
  removedPorts: number[];
  remainingPorts: number[];
};

export type EndpointRemoval = {
  // Every endpoint of the rule the removal changes, in the rule's order. The
  // endpoint that was chosen is one of them unless it names no port.
  affected: AffectedEndpoint[];
  // No endpoint is left, so the gateway removes the rule as well.
  removesRule: boolean;
};

// Hosts are compared the way the gateway compares them: ASCII letters
// without regard to case, everything else exactly.
const asciiLowerCase = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// What the operations of removeEndpointOperations do to a rule, worked out
// the way the gateway does it (openshell-policy merge.rs, remove_endpoint, at
// v0.1.2): for each port of the chosen endpoint, every endpoint of the rule
// with the same host that has the port loses it, whatever its path, its
// protocol or its rules; an endpoint left without a port is removed, and a
// rule left without an endpoint is removed with it.
//
// It is what the user is shown before the removal is sent, so that nothing is
// removed that was not named.
export const endpointRemovalEffect = (
  rule: NetworkPolicyRule,
  endpoint: NetworkEndpoint,
): EndpointRemoval => {
  const host = asciiLowerCase(endpoint.host ?? '');
  const removed = new Set(endpointPorts(endpoint));
  const endpoints = rule.endpoints ?? [];
  const affected: AffectedEndpoint[] = [];
  let kept = 0;
  endpoints.forEach((candidate, index) => {
    const ports = endpointPorts(candidate);
    const removedPorts =
      asciiLowerCase(candidate.host ?? '') === host
        ? [...new Set(ports.filter((port) => removed.has(port)))]
        : [];
    if (removedPorts.length === 0) {
      kept += 1;
      return;
    }
    const remainingPorts = [
      ...new Set(ports.filter((port) => !removed.has(port))),
    ].sort((a, b) => a - b);
    if (remainingPorts.length > 0) {
      kept += 1;
    }
    affected.push({ endpoint: candidate, index, removedPorts, remainingPorts });
  });
  return {
    affected,
    removesRule: affected.length > 0 && kept === 0,
  };
};

// Explicit allow and deny rules can be appended to REST and WebSocket
// endpoints only (`--add-allow`, `--add-deny`).
export const canAppendL7Rules = (endpoint: NetworkEndpoint): boolean =>
  endpoint.protocol === 'rest' || endpoint.protocol === 'websocket';

// A deny rule narrows an allow set, so there has to be one.
export const hasAllowBase = (endpoint: NetworkEndpoint): boolean =>
  Boolean(endpoint.access) || (endpoint.rules?.length ?? 0) > 0;

// The complete scope an L7 append affects: every port of the endpoint, its
// path scope, and every binary of its rule. The gateway refuses an append
// whose declaration leaves any of it out, so that adding one rule cannot
// quietly widen what another port or binary may do.
export const l7RuleTarget = (
  ruleName: string,
  rule: NetworkPolicyRule,
  endpoint: NetworkEndpoint,
): L7RuleTarget => {
  const binaries: NetworkBinary[] = (rule.binaries ?? []).filter(
    (binary) => binary.path,
  );
  const target: L7RuleTarget = {
    ruleName,
    host: endpoint.host ?? '',
    ports: endpointPorts(endpoint),
    // Always present: an empty path selects the endpoint without a path
    // scope, where leaving it out would match any endpoint of the host.
    path: endpoint.path ?? '',
  };
  if (binaries.length > 0) {
    target.binaries = binaries;
  } else {
    target.anyBinary = true;
  }
  return target;
};

export type L7RuleKind = 'allow' | 'deny';

// `policy update --add-allow|--add-deny host:ports:METHOD:path --rule-name ...`.
export const addL7RuleOperation = (
  kind: L7RuleKind,
  ruleName: string,
  rule: NetworkPolicyRule,
  endpoint: NetworkEndpoint,
  method: string,
  path: string,
): PolicyMergeOperation => {
  const target = l7RuleTarget(ruleName, rule, endpoint);
  const matcher = { method: method.trim().toUpperCase(), path: path.trim() };
  return kind === 'allow'
    ? { addAllowRules: { target, rules: [{ allow: matcher }] } }
    : { addDenyRules: { target, denyRules: [matcher] } };
};

// The appended request path has the shape the CLI requires of it.
export const isValidL7Path = (path: string): boolean => {
  const trimmed = path.trim();
  return (
    trimmed.startsWith('/') || trimmed === '**' || trimmed.startsWith('**/')
  );
};

// NETWORK_ACCESS_PRESET_READ_ONLY -> read-only, and so on: the spelling the
// CLI and policy files use.
export const enumLabel = (value: string | undefined): string =>
  (value ?? '')
    .replace(/^NETWORK_(ACCESS_PRESET|ENFORCEMENT_MODE|TLS_MODE)_/, '')
    .toLowerCase()
    .replace(/_/g, '-');

export const endpointSummary = (ep: NetworkEndpoint): string => {
  const ports = endpointPorts(ep);
  const parts = [
    `${ep.host || '*'}${ports.length ? `:${ports.join(',')}` : ''}`,
  ];
  if (ep.path) parts.push(ep.path);
  if (ep.protocol) parts.push(ep.protocol);
  if (ep.access) parts.push(enumLabel(ep.access));
  if (ep.enforcement) parts.push(enumLabel(ep.enforcement));
  return parts.join(' ');
};

// One allow or deny matcher on a line: the method and path, then whatever
// else it constrains, named rather than spelled out.
export const l7MatchSummary = (match: L7Allow | undefined): string => {
  if (!match) return '(empty)';
  const parts: string[] = [];
  if (match.method) parts.push(match.method);
  if (match.path) parts.push(match.path);
  if (match.command) parts.push(`command ${match.command}`);
  if (match.operationType || match.operationName) {
    parts.push(
      `graphql ${[match.operationType, match.operationName].filter(Boolean).join(' ')}`,
    );
  }
  if (match.fields?.length) parts.push(`fields ${match.fields.join(',')}`);
  const query = Object.keys(match.query ?? {});
  if (query.length) parts.push(`query ${query.sort().join(',')}`);
  const params = Object.keys(match.params ?? {});
  if (params.length) parts.push(`params ${params.sort().join(',')}`);
  return parts.join(' ') || '(empty)';
};

// The fields of an endpoint the summary and the rule lists do not show. They
// are listed by name so that a reader knows the endpoint carries more than
// the row says, and opens the rule to see it.
const SUMMARIZED_ENDPOINT_FIELDS = new Set([
  'host',
  'port',
  'ports',
  'path',
  'protocol',
  'access',
  'enforcement',
  'rules',
  'denyRules',
]);

export const otherEndpointFields = (ep: NetworkEndpoint): string[] =>
  Object.keys(ep)
    .filter((key) => !SUMMARIZED_ENDPOINT_FIELDS.has(key))
    .sort();

// Splits a set of rules into the sandbox's own and the ones the gateway
// composed in for attached providers.
export const splitRules = (
  rules: Record<string, NetworkPolicyRule> | undefined,
): {
  own: Record<string, NetworkPolicyRule>;
  provider: Record<string, NetworkPolicyRule>;
} => {
  const own: Record<string, NetworkPolicyRule> = {};
  const provider: Record<string, NetworkPolicyRule> = {};
  Object.entries(rules ?? {}).forEach(([name, rule]) => {
    (isProviderRuleName(name) ? provider : own)[name] = rule;
  });
  return { own, provider };
};
