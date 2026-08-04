// Client-side starter policy templates for the create-sandbox form.
//
// The gateway has NO server-side policy library — SandboxSpec.policy is a
// required inline field on CreateSandbox, so reusable templates live here in
// the client. Structures follow openshell.sandbox.v1.SandboxPolicy (protojson
// camelCase field names).

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
    id: 'web-audit',
    name: 'Web egress (audit)',
    description:
      'Allows HTTPS to any host in audit mode — requests are logged, not blocked. Use to observe an agent before locking down.',
    policy: {
      ...basePolicy,
      networkPolicies: {
        web_audit: {
          endpoints: [
            {
              host: '**',
              port: 443,
              protocol: 'rest',
              enforcement: 'audit',
              access: 'full',
            },
          ],
        },
      },
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
              enforcement: 'enforce',
              access: 'read-write',
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
              enforcement: 'enforce',
              access: 'read-only',
            },
            {
              host: 'github.com',
              port: 443,
              protocol: 'rest',
              enforcement: 'enforce',
              access: 'read-only',
            },
          ],
          binaries: [{ path: '/usr/bin/git' }],
        },
      },
    },
  },
];
