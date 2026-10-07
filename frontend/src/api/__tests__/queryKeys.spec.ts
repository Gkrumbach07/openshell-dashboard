import { QueryClient, hashKey } from '@tanstack/react-query';

import { sandboxKeys, templateKeys } from '../queryKeys';

// A label selector is text the user types. A list keyed by it must never be
// the same cache entry as a sandbox or a template, whatever was typed.
const TYPED = [
  '',
  'web',
  'team=ml',
  'list',
  '[object Object]',
  '{"labelSelector":"web"}',
];

const families = [
  {
    kind: 'sandbox',
    list: sandboxKeys.list,
    detail: sandboxKeys.detail,
    scope: sandboxKeys.scope,
  },
  {
    kind: 'template',
    list: templateKeys.list,
    detail: templateKeys.detail,
    scope: templateKeys.all,
  },
];

describe.each(families)('$kind query keys', ({ list, detail, scope }) => {
  it('never give a list the key of a detail, whatever the selector and the name', () => {
    for (const selector of TYPED) {
      for (const name of TYPED) {
        expect(hashKey(list('team-a', selector))).not.toBe(
          hashKey(detail('team-a', name)),
        );
      }
    }
  });

  it('give each selector a list of its own, and no selector the same one as the empty selector', () => {
    expect(hashKey(list('team-a', 'team=ml'))).not.toBe(
      hashKey(list('team-a', 'team=ops')),
    );
    expect(hashKey(list('team-a'))).toBe(hashKey(list('team-a', '')));
  });

  it('keep every list and every detail of a workspace under its scope, and nothing else', async () => {
    const client = new QueryClient();
    const keys = {
      plainList: list('team-a'),
      filteredList: list('team-a', 'team=ml'),
      detail: detail('team-a', 'web'),
      otherWorkspace: list('team-b'),
    };
    Object.values(keys).forEach((key) => client.setQueryData(key, 'cached'));

    await client.invalidateQueries({ queryKey: scope('team-a') });

    const invalidated = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated;
    expect(invalidated(keys.plainList)).toBe(true);
    expect(invalidated(keys.filteredList)).toBe(true);
    expect(invalidated(keys.detail)).toBe(true);
    expect(invalidated(keys.otherWorkspace)).toBe(false);
  });

  it('invalidate one detail without touching the lists or another detail', async () => {
    const client = new QueryClient();
    const lists = [list('team-a'), list('team-a', 'web')];
    const other = detail('team-a', 'db');
    const target = detail('team-a', 'web');
    [...lists, other, target].forEach((key) =>
      client.setQueryData(key, 'cached'),
    );

    await client.invalidateQueries({ queryKey: target });

    expect(client.getQueryState(target)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    lists.forEach((key) =>
      expect(client.getQueryState(key)?.isInvalidated).toBe(false),
    );
  });
});
