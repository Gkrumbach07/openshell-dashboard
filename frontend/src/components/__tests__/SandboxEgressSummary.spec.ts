import { getPolicySummary } from '../sandbox/SandboxEgressSummary';
import type { SandboxPolicy, SandboxPolicyView } from '../../types';

describe('getPolicySummary', () => {
  it('reports "Never loaded" when version is 0', () => {
    const result = getPolicySummary(undefined, undefined, 0);
    expect(result.title).toBe('Never loaded');
    expect(result.iconColor).toContain('warning');
  });

  it('reports enforced with host count', () => {
    const policy: SandboxPolicy = {
      version: 1,
      networkPolicies: {
        rule1: {
          endpoints: [
            { host: 'api.example.com', port: 443 },
            { host: 'cdn.example.com', port: 443 },
          ],
        },
      },
    };
    const policyView: SandboxPolicyView = {
      activeVersion: 1,
      latest: { version: 1, status: 'LOADED', createdAtMs: Date.now() },
      revisions: [],
    };
    const result = getPolicySummary(policyView, policy, 1);
    expect(result.title).toBe('v1 enforced');
    expect(result.subtitle).toContain('2 hosts');
    expect(result.subtitle).toContain('1 rule');
  });

  it('reports pending status', () => {
    const policy: SandboxPolicy = {
      version: 2,
      networkPolicies: {},
    };
    const policyView: SandboxPolicyView = {
      activeVersion: 2,
      latest: { version: 2, status: 'PENDING', createdAtMs: Date.now() },
      revisions: [],
    };
    const result = getPolicySummary(policyView, policy, 2);
    expect(result.title).toBe('v2 pending');
  });

  it('reports failed status', () => {
    const fallbackPolicy: SandboxPolicy = {
      version: 3,
      networkPolicies: {},
    };
    const policyView: SandboxPolicyView = {
      activeVersion: 3,
      latest: {
        version: 3,
        status: 'FAILED',
        loadError: 'bad config',
        createdAtMs: Date.now(),
        policy: fallbackPolicy,
      },
      revisions: [],
    };
    const result = getPolicySummary(policyView, fallbackPolicy, 3);
    expect(result.title).toBe('v3 failed');
    expect(result.iconColor).toContain('danger');
  });

  it('reports no egress when version > 0 but no hosts', () => {
    const policy: SandboxPolicy = {
      version: 1,
      networkPolicies: {},
    };
    const policyView: SandboxPolicyView = {
      activeVersion: 1,
      latest: { version: 1, status: 'LOADED', createdAtMs: Date.now() },
      revisions: [],
    };
    const result = getPolicySummary(policyView, policy, 1);
    expect(result.subtitle).toContain('no egress');
  });
});
