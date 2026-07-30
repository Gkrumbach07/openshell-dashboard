import { formatAge, parseLabels, resolveImage } from '../utils';

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
import { policyTemplates } from '../policyTemplates';

describe('parseLabels', () => {
  it('parses comma-separated pairs', () => {
    expect(parseLabels('team=ml, kind=agent')).toEqual({ team: 'ml', kind: 'agent' });
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
