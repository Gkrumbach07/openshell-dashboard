import { formatAge, formatTimestamp, formatUptime } from '../../utils/formatters';
import {
  countEgressHosts,
  getEnforcementColor,
  getEnforcementLabel,
} from '../sandbox/SandboxEgressSummary';
import { getStatusDotColor } from '../StatusDot';
import { parseLabels, resolveImage } from '../../hooks/useCreateSandboxForm';
import type { NetworkPolicyRule } from '../../types';

describe('resolveImage', () => {
  it('resolves bare community names', () => {
    expect(resolveImage('python')).toBe(
      'ghcr.io/nvidia/openshell-community/sandboxes/python:latest',
    );
  });

  it('keeps full references untouched', () => {
    expect(resolveImage('ghcr.io/acme/img:v1')).toBe('ghcr.io/acme/img:v1');
    expect(resolveImage('img:tag')).toBe('img:tag');
    expect(resolveImage('registry.local/img')).toBe('registry.local/img');
  });
});
import { policyTemplates } from '../policy/policyTemplates';

describe('parseLabels', () => {
  it('parses comma-separated pairs', () => {
    expect(parseLabels('team=ml, kind=agent')).toEqual({
      team: 'ml',
      kind: 'agent',
    });
  });

  it('keeps equals signs inside values', () => {
    expect(parseLabels('query=a=b')).toEqual({ query: 'a=b' });
  });

  it('returns empty map for blank input', () => {
    expect(parseLabels('  ')).toEqual({});
  });

  it('rejects malformed pairs', () => {
    expect(parseLabels('noequals')).toBeNull();
    expect(parseLabels('key=')).toBeNull();
    expect(parseLabels('=value')).toBeNull();
  });
});

describe('formatAge', () => {
  const now = 1_000_000_000_000;

  it('formats seconds', () => {
    expect(formatAge(now - 30_000, now)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m');
  });

  it('formats hours', () => {
    expect(formatAge(now - (3 * 3600_000 + 12 * 60_000), now)).toBe('3h 12m');
  });

  it('formats days', () => {
    expect(formatAge(now - 49 * 3600_000, now)).toBe('2d 1h');
  });

  it('handles missing timestamps', () => {
    expect(formatAge(0, now)).toBe('-');
  });
});

describe('formatTimestamp', () => {
  it('formats a valid timestamp', () => {
    const result = formatTimestamp(1_700_000_000_000);
    expect(result).not.toBe('-');
    expect(typeof result).toBe('string');
  });

  it('returns dash for undefined', () => {
    expect(formatTimestamp(undefined)).toBe('-');
  });

  it('returns dash for zero', () => {
    expect(formatTimestamp(0)).toBe('-');
  });
});

describe('formatUptime', () => {
  const now = 1_000_000_000_000;

  it('formats seconds', () => {
    expect(formatUptime(now - 45_000, now)).toBe('up 45s');
  });

  it('formats minutes', () => {
    expect(formatUptime(now - 10 * 60_000, now)).toBe('up 10m');
  });

  it('formats hours and minutes', () => {
    expect(formatUptime(now - (2 * 3600_000 + 30 * 60_000), now)).toBe(
      'up 2h 30m',
    );
  });

  it('formats days', () => {
    expect(formatUptime(now - 49 * 3600_000, now)).toBe('up 2d 1h');
  });

  it('returns empty string for missing timestamp', () => {
    expect(formatUptime(0, now)).toBe('');
  });

  it('returns empty string for future timestamp', () => {
    expect(formatUptime(now + 10_000, now)).toBe('');
  });
});

describe('getStatusDotColor', () => {
  it('returns success color for READY', () => {
    expect(getStatusDotColor('READY')).toContain('success');
  });

  it('returns danger color for ERROR', () => {
    expect(getStatusDotColor('ERROR')).toContain('danger');
  });

  it('returns info color for PROVISIONING', () => {
    expect(getStatusDotColor('PROVISIONING')).toContain('info');
  });

  it('returns warning color for DELETING', () => {
    expect(getStatusDotColor('DELETING')).toContain('warning');
  });

  it('returns custom color for UNKNOWN', () => {
    expect(getStatusDotColor('UNKNOWN')).toContain('custom');
  });

  it('returns custom color for UNSPECIFIED', () => {
    expect(getStatusDotColor('UNSPECIFIED')).toContain('custom');
  });
});

describe('countEgressHosts', () => {
  it('returns 0 for empty policies', () => {
    expect(countEgressHosts({})).toBe(0);
  });

  it('counts unique host:port combinations', () => {
    const policies: Record<string, NetworkPolicyRule> = {
      rule1: {
        endpoints: [
          { host: 'api.example.com', port: 443 },
          { host: 'api.other.com', port: 8080 },
        ],
      },
    };
    expect(countEgressHosts(policies)).toBe(2);
  });

  it('deduplicates identical host:port across rules', () => {
    const policies: Record<string, NetworkPolicyRule> = {
      rule1: { endpoints: [{ host: 'api.example.com', port: 443 }] },
      rule2: { endpoints: [{ host: 'api.example.com', port: 443 }] },
    };
    expect(countEgressHosts(policies)).toBe(1);
  });

  it('treats different ports on same host as distinct', () => {
    const policies: Record<string, NetworkPolicyRule> = {
      rule1: {
        endpoints: [
          { host: 'api.example.com', port: 443 },
          { host: 'api.example.com', port: 8080 },
        ],
      },
    };
    expect(countEgressHosts(policies)).toBe(2);
  });

  it('defaults port to 443 when missing', () => {
    const policies: Record<string, NetworkPolicyRule> = {
      rule1: { endpoints: [{ host: 'api.example.com' }] },
    };
    expect(countEgressHosts(policies)).toBe(1);
  });

  it('skips endpoints without a host', () => {
    const policies: Record<string, NetworkPolicyRule> = {
      rule1: { endpoints: [{ port: 443 }] },
    };
    expect(countEgressHosts(policies)).toBe(0);
  });
});

describe('getEnforcementLabel', () => {
  it('returns enforce for rules without endpoints', () => {
    expect(getEnforcementLabel({})).toBe('enforce');
  });

  it('returns advisor when advisorProposed is true', () => {
    expect(
      getEnforcementLabel({
        endpoints: [{ host: 'a.com', advisorProposed: true }],
      }),
    ).toBe('advisor');
  });

  it('returns the enforcement value from the endpoint', () => {
    expect(
      getEnforcementLabel({
        endpoints: [{ host: 'a.com', enforcement: 'observe' }],
      }),
    ).toBe('observe');
  });

  it('defaults to enforce when enforcement is missing', () => {
    expect(getEnforcementLabel({ endpoints: [{ host: 'a.com' }] })).toBe(
      'enforce',
    );
  });
});

describe('getEnforcementColor', () => {
  it('returns green for enforce', () => {
    expect(getEnforcementColor('enforce')).toBe('green');
  });

  it('returns blue for observe', () => {
    expect(getEnforcementColor('observe')).toBe('blue');
  });

  it('returns blue for advisor', () => {
    expect(getEnforcementColor('advisor')).toBe('blue');
  });

  it('returns grey for unknown modes', () => {
    expect(getEnforcementColor('unknown')).toBe('grey');
    expect(getEnforcementColor('')).toBe('grey');
  });
});

describe('policyTemplates', () => {
  it('every template carries a required policy with filesystem defaults', () => {
    for (const template of policyTemplates) {
      expect(template.policy.version).toBe(1);
      expect(template.policy.filesystem?.readWrite).toContain('/sandbox');
      // networkPolicies must always be present (possibly empty) so the JSON
      // sent to CreateSandbox is a complete SandboxPolicy.
      expect(template.policy.networkPolicies).toBeDefined();
    }
  });

  it('enforced endpoints declare host and port', () => {
    for (const template of policyTemplates) {
      for (const rule of Object.values(template.policy.networkPolicies ?? {})) {
        for (const endpoint of rule.endpoints ?? []) {
          expect(endpoint.host).toBeTruthy();
          expect(endpoint.port).toBeGreaterThan(0);
        }
      }
    }
  });
});
