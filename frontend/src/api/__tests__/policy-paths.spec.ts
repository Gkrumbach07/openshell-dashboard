import {
  approveAllDraftChunks,
  getEffectiveSandboxPolicy,
  getGlobalPolicyRevision,
  getSandboxPolicyRevision,
  mergeSandboxPolicy,
} from '../policy';
import { policyKeys } from '../queryKeys';

jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

import { get, post } from '../client';
const mockGet = get as jest.Mock;
const mockPost = post as jest.Mock;

describe('policy API paths', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mergeSandboxPolicy posts the operations and nothing else', async () => {
    const operations = [{ removeRule: { ruleName: 'gh' } }];
    await mergeSandboxPolicy('team a', 'sb1', operations);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/team%20a/sandboxes/sb1/policy/merge',
      { operations },
    );
  });

  it('getEffectiveSandboxPolicy calls correct path', async () => {
    await getEffectiveSandboxPolicy('default', 'sb1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/policy/effective',
    );
  });

  it('reads one revision by its number, sandbox and global', async () => {
    await getSandboxPolicyRevision('default', 'sb1', 3);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/policy/revisions/3',
    );
    await getGlobalPolicyRevision(7);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/global-policy/revisions/7');
  });

  it('approveAllDraftChunks sends the approvals it is given', async () => {
    const approvals = [{ chunkId: 'c1', reviewToken: 'tok-1' }];
    await approveAllDraftChunks('default', 'sb1', true, approvals);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts/approve-all',
      { includeSecurityFlagged: true, approvals },
    );
  });

  it('approveAllDraftChunks without approvals keeps the body it always sent', async () => {
    await approveAllDraftChunks('default', 'sb1', false);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/workspaces/default/sandboxes/sb1/drafts/approve-all',
      { includeSecurityFlagged: false },
    );
  });
});

describe('policy query keys', () => {
  // Invalidation is by prefix: a change to a sandbox's policy has to reach
  // its effective policy, and a draft decision every filtered inbox.
  it('nests the effective policy under the sandbox policy', () => {
    const base = policyKeys.sandbox('team-a', 'sb1');
    expect(policyKeys.effective('team-a', 'sb1').slice(0, base.length)).toEqual(
      [...base],
    );
  });

  it('nests a filtered inbox under the unfiltered one, and leaves that key as it was', () => {
    expect(policyKeys.drafts('team-a', 'sb1')).toEqual([
      'drafts',
      'team-a',
      'sb1',
    ]);
    expect(policyKeys.drafts('team-a', 'sb1', '')).toEqual([
      'drafts',
      'team-a',
      'sb1',
    ]);
    expect(policyKeys.drafts('team-a', 'sb1', 'pending')).toEqual([
      'drafts',
      'team-a',
      'sb1',
      'pending',
    ]);
  });
});
