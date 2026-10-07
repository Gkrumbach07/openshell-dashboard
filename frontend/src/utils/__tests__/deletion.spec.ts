import { AlertVariant } from '@patternfly/react-core';

import {
  deletionOutcome,
  describeDeletion,
  describeDeletions,
} from '../deletion';
import type { DeletionOutcome } from '../../types';

const sandbox = { singular: 'sandbox', plural: 'sandboxes' };

describe('deletionOutcome', () => {
  it.each<[string, unknown, DeletionOutcome]>([
    ['completed', { outcome: 'completed', deleted: true }, 'completed'],
    ['accepted', { outcome: 'accepted', deleted: false }, 'accepted'],
    [
      'already absent',
      { outcome: 'already_absent', deleted: true },
      'already_absent',
    ],
    ['unspecified', { outcome: 'unspecified', deleted: false }, 'unspecified'],
    // An outcome this build does not know is not a deletion, whatever the
    // rest of the answer says.
    [
      'an outcome nobody knows',
      { outcome: 'archived', deleted: true },
      'unspecified',
    ],
    // An endpoint that reports no outcome at all, only that it deleted.
    ['only deleted: true', { deleted: true }, 'completed'],
    ['only deleted: false', { deleted: false }, 'unspecified'],
    ['an empty answer', {}, 'unspecified'],
    ['no answer', undefined, 'unspecified'],
    ['null', null, 'unspecified'],
    ['not an object', 'completed', 'unspecified'],
  ])('reads %s', (_name, result, want) => {
    expect(deletionOutcome(result)).toBe(want);
  });
});

describe('describeDeletion', () => {
  it.each<[DeletionOutcome, AlertVariant, string]>([
    ['completed', AlertVariant.success, 'Sandbox "agent-1" deleted'],
    [
      'accepted',
      AlertVariant.info,
      'Sandbox "agent-1" deletion accepted; cleanup is pending',
    ],
    [
      'already_absent',
      AlertVariant.success,
      'Sandbox "agent-1" already deleted',
    ],
    [
      'unspecified',
      AlertVariant.danger,
      'Unsupported deletion outcome for sandbox "agent-1"',
    ],
  ])('says what %s means', (outcome, variant, title) => {
    expect(describeDeletion(sandbox, 'agent-1', outcome)).toEqual({
      variant,
      title,
    });
  });

  it('only calls a completed deletion deleted', () => {
    expect(describeDeletion(sandbox, 'a', 'accepted').title).not.toMatch(
      /"a" deleted$/,
    );
    expect(describeDeletion(sandbox, 'a', 'unspecified').title).not.toMatch(
      /deleted$/,
    );
  });

  it('names the kind of resource', () => {
    expect(
      describeDeletion(
        { singular: 'provider', plural: 'providers' },
        'claude',
        'completed',
      ).title,
    ).toBe('Provider "claude" deleted');
  });
});

describe('describeDeletions', () => {
  it('describes one resource by name', () => {
    expect(describeDeletions(sandbox, ['agent-1'], ['accepted'])).toEqual(
      describeDeletion(sandbox, 'agent-1', 'accepted'),
    );
  });

  it('counts several that were all deleted', () => {
    expect(
      describeDeletions(
        sandbox,
        ['a', 'b', 'c'],
        ['completed', 'completed', 'completed'],
      ),
    ).toEqual({ variant: AlertVariant.success, title: '3 sandboxes deleted' });
  });

  it('does not report accepted deletions as deleted', () => {
    expect(
      describeDeletions(sandbox, ['a', 'b'], ['accepted', 'accepted']),
    ).toEqual({
      variant: AlertVariant.info,
      title: '2 sandbox deletions accepted; cleanup is pending',
    });
  });

  it('tells a mixed result apart', () => {
    expect(
      describeDeletions(
        sandbox,
        ['a', 'b', 'c', 'd'],
        ['completed', 'accepted', 'completed', 'already_absent'],
      ),
    ).toEqual({
      variant: AlertVariant.info,
      title:
        '2 sandboxes deleted. 1 sandbox deletion accepted; cleanup is pending. 1 sandbox already deleted',
    });
  });

  it('is a failure as soon as one outcome is unsupported', () => {
    const notice = describeDeletions(
      sandbox,
      ['a', 'b'],
      ['completed', 'unspecified'],
    );
    expect(notice.variant).toBe(AlertVariant.danger);
    expect(notice.title).toBe(
      '1 sandbox deleted. Unsupported deletion outcome for 1 sandbox',
    );
  });

  it('treats a name without an outcome as unsupported', () => {
    const notice = describeDeletions(sandbox, ['a', 'b'], ['completed']);
    expect(notice.variant).toBe(AlertVariant.danger);
    expect(notice.title).toContain(
      'Unsupported deletion outcome for 1 sandbox',
    );
  });
});
