import { parse } from 'yaml';

import { REDACTED, providerToRedactedYaml } from '../providerYaml';
import type { Provider } from '../../types';

const provider = (overrides: Partial<Provider> = {}): Provider => ({
  metadata: {
    id: 'id-1',
    name: 'my-provider',
    workspace: 'team-a',
    createdAtMs: 0,
    resourceVersion: 3,
  },
  type: 'openai',
  ...overrides,
});

// The TUI's "Object YAML": provider_to_redacted_yaml in
// crates/openshell-tui/src/app.rs at v0.1.2. Each expectation below is what
// that function prints for the same provider.
describe('providerToRedactedYaml', () => {
  it('prints an empty provider with its empty maps', () => {
    expect(providerToRedactedYaml(provider())).toBe(
      [
        'name: "my-provider"',
        'type: "openai"',
        'credentials: {}',
        'config: {}',
        'metadata:',
        '  id: "id-1"',
        '  resource_version: 3',
        '',
      ].join('\n'),
    );
  });

  it('prints every field, with the maps in key order', () => {
    expect(
      providerToRedactedYaml(
        provider({
          credentialNames: ['OPENAI_API_KEY', 'ALT_KEY'],
          config: { region: 'us', base_url: 'https://api.example' },
          credentialExpiresAtMs: {
            OPENAI_API_KEY: Date.UTC(2030, 0, 1),
            ALT_KEY: Date.UTC(2030, 0, 1, 12, 30, 15, 250),
          },
          metadata: {
            id: 'id-1',
            name: 'my-provider',
            workspace: 'team-a',
            createdAtMs: 0,
            resourceVersion: 12,
            labels: { team: 'ml', env: 'prod' },
          },
        }),
      ),
    ).toBe(
      [
        'name: "my-provider"',
        'type: "openai"',
        'credentials:',
        '  ALT_KEY: "<redacted>"',
        '  OPENAI_API_KEY: "<redacted>"',
        'config:',
        '  base_url: "https://api.example"',
        '  region: "us"',
        'credential_expiration_times:',
        // A fraction of a second is printed only when there is one.
        '  ALT_KEY: 2030-01-01T12:30:15.250Z',
        '  OPENAI_API_KEY: 2030-01-01T00:00:00Z',
        'metadata:',
        '  id: "id-1"',
        '  resource_version: 12',
        '  labels:',
        '    env: "prod"',
        '    team: "ml"',
        '',
      ].join('\n'),
    );
  });

  it('escapes what a quoted scalar cannot hold as it is', () => {
    const yaml = providerToRedactedYaml(
      provider({
        config: {
          quoted: 'say "hi"',
          path: 'C:\\temp',
          lines: 'one\ntwo\r\n\tthree',
        },
      }),
    );
    expect(yaml).toContain('  quoted: "say \\"hi\\""');
    expect(yaml).toContain('  path: "C:\\\\temp"');
    expect(yaml).toContain('  lines: "one\\ntwo\\r\\n\\tthree"');
    // And it reads back as what went in.
    expect(parse(yaml).config).toEqual({
      quoted: 'say "hi"',
      path: 'C:\\temp',
      lines: 'one\ntwo\r\n\tthree',
    });
  });

  it('masks every credential the same way and prints no value', () => {
    const leaky = {
      ...provider({ credentialNames: ['A_KEY', 'B_KEY'] }),
      // Not a field of Provider, and not something the BFF sends. A value
      // that reached the page some other way is still not printed.
      credentials: { A_KEY: 'sk-live-not-a-real-secret', B_KEY: 'REDACTED' },
    } as Provider;
    const yaml = providerToRedactedYaml(leaky);

    expect(parse(yaml).credentials).toEqual({
      A_KEY: REDACTED,
      B_KEY: REDACTED,
    });
    expect(yaml).not.toContain('sk-live-not-a-real-secret');
    expect(yaml).not.toContain('REDACTED');
  });

  it('prints what the TUI prints and nothing more', () => {
    const yaml = providerToRedactedYaml(
      provider({
        profileWorkspace: 'team-a',
        metadata: {
          id: 'id-1',
          name: 'my-provider',
          workspace: 'team-a',
          createdAtMs: 1_700_000_000_000,
          resourceVersion: 3,
          annotations: { note: 'x' },
        },
      }),
    );
    expect(Object.keys(parse(yaml))).toEqual([
      'name',
      'type',
      'credentials',
      'config',
      'metadata',
    ]);
    expect(Object.keys(parse(yaml).metadata)).toEqual([
      'id',
      'resource_version',
    ]);
  });

  it('does not fail on an expiry that is no date', () => {
    expect(
      providerToRedactedYaml(
        provider({ credentialExpiresAtMs: { A_KEY: Number.MAX_VALUE } }),
      ),
    ).toContain(`  A_KEY: ${Number.MAX_VALUE}`);
  });
});
