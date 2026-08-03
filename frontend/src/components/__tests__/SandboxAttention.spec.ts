import { buildAttentionItems } from '../SandboxAttention';
import type {
  Sandbox,
  DraftSandboxSummary,
  SandboxPolicyView,
} from '../../types';

const makeSandbox = (overrides: Partial<Sandbox> = {}): Sandbox => ({
  metadata: {
    id: 'uuid-1',
    name: 'test-sandbox',
    workspace: 'default',
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
  },
  spec: { image: 'python', policy: { version: 1, networkPolicies: {} } },
  status: {
    phase: 'READY',
    currentPolicyVersion: 1,
  },
  ...overrides,
});

describe('buildAttentionItems', () => {
  it('returns empty array for a healthy READY sandbox', () => {
    const items = buildAttentionItems(makeSandbox(), undefined, undefined);
    expect(items).toEqual([]);
  });

  it('returns danger alert for ERROR phase', () => {
    const sandbox = makeSandbox({
      status: { phase: 'ERROR', currentPolicyVersion: 0 },
    });
    const items = buildAttentionItems(sandbox, undefined, undefined);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].variant).toBe('danger');
    expect(items[0].key).toBe('error');
  });

  it('includes condition reason in error alert', () => {
    const sandbox = makeSandbox({
      status: {
        phase: 'ERROR',
        currentPolicyVersion: 1,
        conditions: [
          { type: 'Ready', status: 'False', reason: 'ImagePullErr' },
        ],
      },
    });
    const items = buildAttentionItems(sandbox, undefined, undefined);
    expect(items[0].title).toBe('ImagePullErr');
  });

  it('returns info alert for pending drafts', () => {
    const draft: DraftSandboxSummary = {
      workspace: 'default',
      sandboxName: 'test-sandbox',
      pendingCount: 3,
      hasSecurityFlags: false,
      latestDraftMs: Date.now(),
    };
    const items = buildAttentionItems(makeSandbox(), draft, undefined);
    expect(items).toHaveLength(1);
    expect(items[0].variant).toBe('info');
    expect(items[0].title).toContain('3 rules proposed');
  });

  it('returns warning for drafts with security flags', () => {
    const draft: DraftSandboxSummary = {
      workspace: 'default',
      sandboxName: 'test-sandbox',
      pendingCount: 1,
      hasSecurityFlags: true,
      latestDraftMs: Date.now(),
    };
    const items = buildAttentionItems(makeSandbox(), draft, undefined);
    expect(items[0].variant).toBe('warning');
    expect(items[0].title).toContain('with findings');
  });

  it('skips drafts alert when sandbox is in ERROR', () => {
    const sandbox = makeSandbox({
      status: { phase: 'ERROR', currentPolicyVersion: 1 },
    });
    const draft: DraftSandboxSummary = {
      workspace: 'default',
      sandboxName: 'test-sandbox',
      pendingCount: 2,
      hasSecurityFlags: false,
      latestDraftMs: Date.now(),
    };
    const items = buildAttentionItems(sandbox, draft, undefined);
    const draftItems = items.filter((i) => i.key === 'drafts');
    expect(draftItems).toHaveLength(0);
  });

  it('returns danger for failed policy revision', () => {
    const policyView: SandboxPolicyView = {
      activeVersion: 1,
      latest: {
        version: 2,
        status: 'FAILED',
        loadError: 'Invalid policy',
        createdAtMs: Date.now(),
      },
      revisions: [],
    };
    const items = buildAttentionItems(makeSandbox(), undefined, policyView);
    expect(items).toHaveLength(1);
    expect(items[0].variant).toBe('danger');
    expect(items[0].title).toContain('failed to load');
  });

  it('returns danger for expired provider credentials', () => {
    const sandbox = makeSandbox({
      spec: {
        image: 'python',
        providers: ['my-provider'],
        policy: { version: 1, networkPolicies: {} },
      },
    });
    const expiry = { 'my-provider': Date.now() - 1000 };
    const items = buildAttentionItems(
      sandbox,
      undefined,
      undefined,
      undefined,
      expiry,
    );
    expect(items).toHaveLength(1);
    expect(items[0].variant).toBe('danger');
    expect(items[0].title).toContain('expired');
  });

  it('returns warning for soon-expiring provider credentials', () => {
    const sandbox = makeSandbox({
      spec: {
        image: 'python',
        providers: ['my-provider'],
        policy: { version: 1, networkPolicies: {} },
      },
    });
    const expiry = { 'my-provider': Date.now() + 30 * 60 * 1000 };
    const items = buildAttentionItems(
      sandbox,
      undefined,
      undefined,
      undefined,
      expiry,
    );
    expect(items).toHaveLength(1);
    expect(items[0].variant).toBe('warning');
    expect(items[0].title).toContain('expiring soon');
  });
});
