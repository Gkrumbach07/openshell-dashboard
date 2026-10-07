import { buildAttentionItems } from '../sandbox/SandboxAttention';
import type { DraftSandboxSummary, Sandbox, SandboxStatus } from '../../types';

const REJECTED =
  'Effective configuration could not be activated; replace the policy or repair attached providers';

const makeSandbox = (status: Partial<SandboxStatus> = {}): Sandbox => ({
  metadata: {
    id: 'uuid-1',
    name: 'test-sandbox',
    workspace: 'default',
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
  },
  spec: { image: 'python', policy: { version: 1, networkPolicies: {} } },
  status: { phase: 'READY', currentPolicyVersion: 1, ...status },
});

// What gateway 0.1.2 reports for a sandbox whose configuration was rejected:
// it stays in PROVISIONING, with these two conditions and this admission.
const rejectedStatus: Partial<SandboxStatus> = {
  phase: 'PROVISIONING',
  currentPolicyVersion: 0,
  conditions: [
    {
      type: 'ConfigurationReady',
      status: 'False',
      reason: 'ConfigurationInvalid',
      message: REJECTED,
    },
    {
      type: 'Ready',
      status: 'False',
      reason: 'ConfigurationInvalid',
      message: REJECTED,
    },
  ],
  configurationAdmission: {
    state: 'REJECTED',
    policyVersion: 0,
    configRevision: '17409066226973652438',
    providerEnvRevision: '3176606324465211593',
    error: REJECTED,
  },
};

describe('buildAttentionItems: a rejected configuration', () => {
  it('says so for a sandbox that is not in ERROR', () => {
    const items = buildAttentionItems(
      makeSandbox(rejectedStatus),
      undefined,
      undefined,
    );
    expect(items).toEqual([
      {
        key: 'invalid-config',
        variant: 'danger',
        title: 'Invalid config',
        description: REJECTED,
      },
    ]);
  });

  it('says so whatever the phase', () => {
    for (const phase of ['READY', 'STOPPED', 'STARTING', 'UNKNOWN'] as const) {
      const items = buildAttentionItems(
        makeSandbox({ ...rejectedStatus, phase }),
        undefined,
        undefined,
      );
      expect(items.map((item) => item.key)).toEqual(['invalid-config']);
    }
  });

  it('says it once when the rejection is also the error', () => {
    const items = buildAttentionItems(
      makeSandbox({ ...rejectedStatus, phase: 'ERROR' }),
      undefined,
      undefined,
    );
    expect(items.map((item) => item.key)).toEqual(['invalid-config']);
  });

  it('keeps the error of a sandbox that failed for another reason', () => {
    const items = buildAttentionItems(
      makeSandbox({
        phase: 'ERROR',
        currentPolicyVersion: 1,
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            reason: 'ContainerExited',
            message: 'Container exited',
          },
          {
            type: 'ConfigurationReady',
            status: 'False',
            reason: 'ConfigurationInvalid',
            message: REJECTED,
          },
        ],
      }),
      undefined,
      undefined,
    );
    expect(items.map((item) => [item.key, item.title])).toEqual([
      ['invalid-config', 'Invalid config'],
      ['error', 'ContainerExited'],
    ]);
  });

  it('has nothing to say about a sandbox still validating its configuration', () => {
    const items = buildAttentionItems(
      makeSandbox({
        phase: 'PROVISIONING',
        currentPolicyVersion: 0,
        conditions: [
          {
            type: 'ConfigurationReady',
            status: 'False',
            reason: 'ConfigurationPending',
          },
        ],
        configurationAdmission: {
          state: 'PENDING',
          policyVersion: 0,
          configRevision: '1',
          providerEnvRevision: '2',
        },
      }),
      undefined,
      undefined,
    );
    expect(items).toEqual([]);
  });
});

describe('buildAttentionItems: proposals that could not be read', () => {
  const unavailable: DraftSandboxSummary = {
    workspace: 'default',
    sandboxName: 'test-sandbox',
    pendingCount: 0,
    hasSecurityFlags: false,
    latestDraftMs: 0,
    unavailable: true,
  };

  it('says the count is unavailable instead of saying nothing', () => {
    const items = buildAttentionItems(makeSandbox(), unavailable, undefined);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'drafts-unavailable',
      variant: 'info',
      title: 'Proposed rules unavailable',
    });
  });

  it('does not offer a review of proposals it could not count', () => {
    const onReviewDrafts = jest.fn();
    const items = buildAttentionItems(makeSandbox(), unavailable, undefined, {
      onReviewDrafts,
    });
    expect(items.some((item) => item.key === 'drafts')).toBe(false);
    expect(items[0].action).toBeUndefined();
  });

  it('says nothing for a sandbox with none pending', () => {
    expect(
      buildAttentionItems(
        makeSandbox(),
        { ...unavailable, unavailable: false },
        undefined,
      ),
    ).toEqual([]);
    expect(buildAttentionItems(makeSandbox(), undefined, undefined)).toEqual(
      [],
    );
  });
});
