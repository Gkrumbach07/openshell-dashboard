import {
  configChanges,
  configRowsOf,
  uniqueProviderName,
} from '../providerForm';

// unique_provider_name in the TUI's app.rs at v0.1.2.
describe('uniqueProviderName', () => {
  const taken = (count: number) => [
    'openai',
    ...Array.from({ length: count }, (_, i) => `openai-${i + 1}`),
  ];

  it.each([
    ['the type when no provider has it', [], 'openai'],
    ['the type when only others exist', ['claude', 'openai-1'], 'openai'],
    ['the type with -1 when the type is taken', ['openai'], 'openai-1'],
    [
      'the first suffix that is free',
      ['openai', 'openai-1', 'openai-3'],
      'openai-2',
    ],
    ['the last suffix it tries', taken(98), 'openai-99'],
    // The TUI gives up there; the gateway then says the name is taken.
    ['the type again when all 99 are taken', taken(99), 'openai'],
  ])('is %s', (_name, existing, want) => {
    expect(uniqueProviderName('openai', existing)).toBe(want);
  });
});

describe('configRowsOf', () => {
  it('is one row for each entry', () => {
    expect(configRowsOf({ a: '1', b: '2' })).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    expect(configRowsOf()).toEqual([]);
  });
});

// What an edit sends as configuration: how spawn_update_provider in the TUI's
// lib.rs builds it. An entry that is sent is written, so what was not changed
// is not sent.
describe('configChanges', () => {
  const original = { region: 'us', tier: 'free', zone: 'a' };
  const rows = (config: Record<string, string>) => configRowsOf(config);

  it.each([
    ['nothing when nothing changed', rows(original), {}],
    ['a changed value', rows({ ...original, region: 'eu' }), { region: 'eu' }],
    ['an added entry', rows({ ...original, team: 'ml' }), { team: 'ml' }],
    [
      'a removed entry, as an empty value',
      rows({ region: 'us', zone: 'a' }),
      { tier: '' },
    ],
    [
      'an entry whose value was emptied, which removes it',
      rows({ ...original, tier: '' }),
      { tier: '' },
    ],
    [
      'all three at once and nothing else',
      rows({ region: 'eu', zone: 'a', team: 'ml' }),
      { region: 'eu', tier: '', team: 'ml' },
    ],
    [
      'every entry when all are removed',
      [],
      { region: '', tier: '', zone: '' },
    ],
  ])('is %s', (_name, edited, want) => {
    expect(configChanges(original, edited)).toEqual(want);
  });

  it('reads a renamed key as one entry removed and one added', () => {
    expect(
      configChanges({ region: 'us' }, [{ key: 'location', value: 'us' }]),
    ).toEqual({ region: '', location: 'us' });
  });

  it('ignores a row without a key and trims the key of one that has it', () => {
    expect(
      configChanges({}, [
        { key: '', value: 'orphan' },
        { key: '   ', value: 'blank' },
        { key: ' team ', value: 'ml' },
      ]),
    ).toEqual({ team: 'ml' });
  });

  it('does not send a new entry that has no value', () => {
    expect(configChanges({}, [{ key: 'team', value: '' }])).toEqual({});
  });

  it('takes the last of two rows with the same key', () => {
    expect(
      configChanges({ region: 'us' }, [
        { key: 'region', value: 'eu' },
        { key: 'region', value: 'us' },
      ]),
    ).toEqual({});
  });

  // The point of it: the form opened on `original`; the provider is by now
  // whatever anybody else made it. What they changed is not in the request.
  it('does not depend on what the provider is by now', () => {
    const changes = configChanges(
      original,
      rows({ ...original, region: 'eu' }),
    );
    expect(changes).toEqual({ region: 'eu' });
    expect(changes).not.toHaveProperty('tier');
    expect(changes).not.toHaveProperty('zone');
  });

  // A configuration key is any text. One that is also the name of something
  // every object has is still only a key.
  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'removes an entry whose key is "%s"',
    (key) => {
      expect(
        configChanges({ [key]: 'x', region: 'us' }, [
          { key: 'region', value: 'us' },
        ]),
      ).toEqual({ [key]: '' });
    },
  );

  it.each(['constructor', 'toString'])(
    'adds an entry whose key is "%s", and sends none that has no value',
    (key) => {
      expect(configChanges({}, [{ key, value: 'x' }])).toEqual({ [key]: 'x' });
      expect(configChanges({}, [{ key, value: '' }])).toEqual({});
    },
  );

  it('treats "__proto__" as the key it is', () => {
    const held = JSON.parse('{"__proto__":"x","region":"us"}') as Record<
      string,
      string
    >;

    const added = configChanges({}, [{ key: '__proto__', value: 'x' }]);
    expect(Object.keys(added)).toEqual(['__proto__']);
    expect(JSON.stringify(added)).toBe('{"__proto__":"x"}');

    const removed = configChanges(held, [{ key: 'region', value: 'us' }]);
    expect(JSON.stringify(removed)).toBe('{"__proto__":""}');

    expect(
      JSON.stringify(
        configChanges(held, [
          { key: '__proto__', value: 'x' },
          { key: 'region', value: 'us' },
        ]),
      ),
    ).toBe('{}');
  });
});
