import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { policyTemplates } from '../policy/policyTemplates';
import type { SandboxPolicy } from '../../types';

// The starter policies of the Create Sandbox form, as the compat suite reads
// them. TestPolicyPresets (backend/test/compat) creates a sandbox from each
// against a real gateway, which is the only check that a starter policy is one
// the gateway accepts. This spec ties that file to the policies the form
// really offers: without it the two could drift apart and the compat suite
// would go on proving policies nobody is offered.
const PRESETS_FILE = resolve(
  __dirname,
  '../../../../backend/test/compat/testdata/policy_presets.json',
);

type Preset = { id: string; policy: SandboxPolicy };

const readPresets = (): Preset[] => {
  if (!existsSync(PRESETS_FILE)) {
    throw new Error(
      `${PRESETS_FILE} is missing. It holds the copy of policyTemplates.ts that the compat suite checks against a real gateway.`,
    );
  }
  return JSON.parse(readFileSync(PRESETS_FILE, 'utf8')) as Preset[];
};

// What the form sends for a template: the policy as JSON.
const onTheWire = (policy: SandboxPolicy): unknown =>
  JSON.parse(JSON.stringify(policy));

describe('policyTemplates', () => {
  it('are the policies the compat suite checks against a real gateway', () => {
    const offered = policyTemplates.map(({ id, policy }) => ({
      id,
      policy: onTheWire(policy),
    }));
    // When this fails, a starter policy was changed, added or removed in
    // policyTemplates.ts without backend/test/compat/testdata/
    // policy_presets.json. Make the same change there, so that the compat
    // suite tries the policy the form now offers.
    expect(readPresets()).toEqual(offered);
  });

  it('have ids of their own', () => {
    const ids = policyTemplates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The host shapes gateway 0.1.2 refuses in any policy (openshell-policy,
  // validate_sandbox_policy): a bare wildcard, a wildcard directly under a
  // top-level domain, `**` anywhere but as the whole first label, and a `*`
  // that is only part of a later label. A real gateway is what decides, in the
  // compat suite; this catches the known shapes before a gateway is needed.
  const refusedHost = (host: string): string | undefined => {
    if (host === '*' || host === '**') {
      return 'a bare wildcard matches every host';
    }
    if (!host.includes('*')) {
      return undefined;
    }
    const labels = host.split('.');
    if (
      (host.startsWith('*.') || host.startsWith('**.')) &&
      labels.length <= 2
    ) {
      return 'a wildcard directly under a top-level domain';
    }
    if (labels[0].includes('**') && labels[0] !== '**') {
      return '** must be the whole first label';
    }
    if (
      labels
        .slice(1)
        .some(
          (label) =>
            label.includes('**') || (label.includes('*') && label !== '*'),
        )
    ) {
      return 'a wildcard in a later label must be the whole label *';
    }
    return undefined;
  };

  it('knows the host shapes the gateway refuses', () => {
    for (const host of [
      '*',
      '**',
      '*.com',
      '**.org',
      '*.*',
      'a**.example.com',
      '*.s3.us-*.amazonaws.com',
      'api.**.example.com',
    ]) {
      expect(refusedHost(host)).toBeDefined();
    }
    for (const host of [
      'api.github.com',
      '*.example.com',
      '**.example.com',
      '*.s3.*.amazonaws.com',
    ]) {
      expect(refusedHost(host)).toBeUndefined();
    }
  });

  it('name no host the gateway refuses', () => {
    const refused: string[] = [];
    for (const template of policyTemplates) {
      for (const [name, rule] of Object.entries(
        template.policy.networkPolicies ?? {},
      )) {
        for (const endpoint of rule.endpoints ?? []) {
          const reason = refusedHost(endpoint.host ?? '');
          if (reason) {
            refused.push(
              `${template.id}: rule ${name}, host "${endpoint.host}": ${reason}`,
            );
          }
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it('starts with the locked-down policy, which the forms open with', () => {
    expect(policyTemplates[0].id).toBe('locked-down');
    expect(policyTemplates[0].policy.networkPolicies).toEqual({});
  });
});
