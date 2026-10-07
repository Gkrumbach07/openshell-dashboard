// Client-side starter policy templates for the create-sandbox form.
//
// The gateway has NO server-side policy library — a sandbox carries its policy
// inline (SandboxSpec.policy), so reusable templates live here in the client.
// Structures follow openshell.sandbox.v1.SandboxPolicy (protojson camelCase
// field names).
//
// Every policy here is also in backend/test/compat/testdata/policy_presets.json,
// and policyTemplates.spec.ts fails when the two differ. The compat suite
// creates a sandbox from each policy in that file against a real gateway, which
// is the only thing that shows a template is one the gateway accepts: the
// gateway validates hosts, ports and wildcards, and its rules change between
// releases. There is no "any host" template because there is no such host
// pattern. Gateway 0.1.2 refuses `*` and `**` on their own and a wildcard
// directly under a top-level domain (`*.com`, `**.com`).

import type { SandboxPolicy } from '../../types';

export type PolicyTemplate = {
  id: string;
  name: string;
  description: string;
  policy: SandboxPolicy;
};

const basePolicy: Pick<
  SandboxPolicy,
  'version' | 'filesystem' | 'landlock' | 'process'
> = {
  version: 1,
  filesystem: {
    includeWorkdir: true,
    readOnly: ['/usr', '/lib', '/proc', '/app', '/etc'],
    readWrite: ['/sandbox', '/tmp'],
  },
  landlock: { compatibility: 'best_effort' },
  process: { runAsUser: 'sandbox', runAsGroup: 'sandbox' },
};

export const policyTemplates: PolicyTemplate[] = [
  {
    id: 'locked-down',
    name: 'Locked down (no network)',
    description:
      'Standard filesystem sandbox with no network egress. Good default for untrusted code.',
    policy: {
      ...basePolicy,
      networkPolicies: {},
    },
  },
  {
    id: 'anthropic-agent',
    name: 'Anthropic API agent',
    description: 'Enforced egress to the Anthropic API only (read-write).',
    policy: {
      ...basePolicy,
      networkPolicies: {
        anthropic: {
          endpoints: [
            {
              host: 'api.anthropic.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_WRITE',
            },
          ],
        },
      },
    },
  },
  {
    id: 'github-readonly',
    name: 'GitHub read-only',
    description:
      'Enforced read-only access to the GitHub API, git binary allowed.',
    policy: {
      ...basePolicy,
      networkPolicies: {
        github: {
          endpoints: [
            {
              host: 'api.github.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
            },
            {
              host: 'github.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
              access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
            },
          ],
          binaries: [{ path: '/usr/bin/git' }],
        },
      },
    },
  },
];
