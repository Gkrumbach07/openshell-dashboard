import {
  formatCommand,
  formatDurationMs,
  formatGpuRequest,
  isUnsplitCommand,
  parseCommand,
  parseDriverConfig,
  parseDurationMs,
  parseServiceExposures,
  rowsToRecord,
  sandboxResourceQuantities,
  userAnnotations,
} from '../sandboxOptions';

describe('rowsToRecord', () => {
  it('reads rows as a map, trimming names and keeping values as typed', () => {
    expect(
      rowsToRecord([
        { key: ' MODE ', value: ' test ' },
        { key: 'EMPTY', value: '' },
      ]),
    ).toEqual({ record: { MODE: ' test ', EMPTY: '' } });
  });

  it('skips a row left entirely empty', () => {
    expect(rowsToRecord([{ key: '', value: '' }])).toEqual({ record: {} });
  });

  it('refuses a value without a name', () => {
    expect(rowsToRecord([{ key: ' ', value: 'x' }]).error).toBe(
      'Every value needs a name',
    );
  });

  it('refuses a name given twice, which would lose one of the values', () => {
    expect(
      rowsToRecord([
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ]).error,
    ).toBe('"A" is listed more than once');
  });
});

describe('parseCommand', () => {
  it('reads one argument per line, each exactly as typed', () => {
    expect(parseCommand('sh\n-c\nexec sleep infinity')).toEqual([
      'sh',
      '-c',
      'exec sleep infinity',
    ]);
  });

  it('skips empty lines and drops carriage returns', () => {
    expect(parseCommand('python\r\n\n-m\r\nhttp.server\n')).toEqual([
      'python',
      '-m',
      'http.server',
    ]);
  });

  it('reads an empty field as no command', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand('\n\n')).toEqual([]);
  });

  it('does not split on spaces: no shell parses the command', () => {
    expect(parseCommand('python -m http.server')).toEqual([
      'python -m http.server',
    ]);
  });
});

describe('isUnsplitCommand', () => {
  it('flags a whole command line typed as one argument', () => {
    expect(isUnsplitCommand(['python -m http.server'])).toBe(true);
  });

  it('leaves alone a single word, and spaces in a later argument', () => {
    expect(isUnsplitCommand(['bash'])).toBe(false);
    expect(isUnsplitCommand(['sh', '-c', 'exec sleep infinity'])).toBe(false);
    expect(isUnsplitCommand([])).toBe(false);
  });
});

describe('formatCommand', () => {
  it('quotes the arguments that would not read as one otherwise', () => {
    expect(formatCommand(['sh', '-c', 'exec sleep infinity'])).toBe(
      'sh -c "exec sleep infinity"',
    );
    expect(formatCommand(['echo', '', 'a"b'])).toBe('echo "" "a\\"b"');
  });

  it('leaves plain arguments as they are', () => {
    expect(formatCommand(['python', '-m', 'http.server', '8080'])).toBe(
      'python -m http.server 8080',
    );
  });
});

describe('parseServiceExposures', () => {
  it('reads a port alone as the unnamed service', () => {
    expect(parseServiceExposures([{ service: '', port: '8080' }])).toEqual({
      exposures: [{ targetPort: 8080 }],
    });
  });

  it('reads named services and skips empty rows', () => {
    expect(
      parseServiceExposures([
        { service: ' web ', port: ' 3000 ' },
        { service: '', port: '' },
        { service: 'api', port: '65535' },
      ]),
    ).toEqual({
      exposures: [
        { service: 'web', targetPort: 3000 },
        { service: 'api', targetPort: 65535 },
      ],
    });
  });

  it.each(['0', '65536', '-1', '80.5', 'http', ''])(
    'refuses %p as a port',
    (port) => {
      expect(parseServiceExposures([{ service: 'web', port }]).error).toBe(
        'Port must be a whole number from 1 to 65535',
      );
    },
  );

  it('refuses a name used twice, as the gateway does', () => {
    expect(
      parseServiceExposures([
        { service: 'web', port: '3000' },
        { service: 'web', port: '3001' },
      ]).error,
    ).toBe('Service "web" is listed more than once');
    expect(
      parseServiceExposures([
        { service: '', port: '3000' },
        { service: '', port: '3001' },
      ]).error,
    ).toBe('Only one service can be left without a name');
  });
});

describe('parseDriverConfig', () => {
  it('reads an empty field as no driver config', () => {
    expect(parseDriverConfig('  ')).toEqual({});
  });

  it('reads a JSON object', () => {
    expect(parseDriverConfig('{"kubernetes": {"pod": {}}}')).toEqual({
      value: { kubernetes: { pod: {} } },
    });
  });

  it('refuses text that is not JSON', () => {
    expect(parseDriverConfig('{kubernetes}').error).toMatch(/^Invalid JSON: /);
  });

  it.each(['[]', '"kubernetes"', '3', 'null', 'true'])(
    'refuses %s, which is JSON but not an object',
    (text) => {
      expect(parseDriverConfig(text).error).toBe(
        'Driver config must be a JSON object keyed by driver name',
      );
    },
  );
});

describe('parseDurationMs', () => {
  it('reads seconds, minutes and hours', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs(' 5m ')).toBe(300_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
  });

  it('reads an empty field as no duration', () => {
    expect(parseDurationMs('')).toBeUndefined();
    expect(parseDurationMs('  ')).toBeUndefined();
  });

  it.each(['30', 's', '1.5m', '-5m', '0s', '5d', '5 m', '1h30m'])(
    'refuses %p',
    (text) => {
      expect(parseDurationMs(text)).toBeNull();
    },
  );
});

describe('formatDurationMs', () => {
  it('uses the largest unit that holds the duration exactly', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h');
    expect(formatDurationMs(5_400_000)).toBe('90m');
    expect(formatDurationMs(30_000)).toBe('30s');
    expect(formatDurationMs(1_500)).toBe('1500ms');
  });
});

describe('sandboxResourceQuantities', () => {
  it('reads the limits the dashboard, the CLI and the gateway write', () => {
    expect(
      sandboxResourceQuantities({
        template: {
          resources: { limits: { cpu: '500m', memory: '512Mi' } },
        },
      }),
    ).toEqual({ cpuLimit: '500m', memoryLimit: '512Mi' });
  });

  it('reads requests when a client set them', () => {
    expect(
      sandboxResourceQuantities({
        template: {
          resources: {
            requests: { cpu: 1, memory: '1Gi' },
            limits: { cpu: '2' },
          },
        },
      }),
    ).toEqual({
      cpuLimit: '2',
      cpuRequest: '1',
      memoryRequest: '1Gi',
    });
  });

  it('reads nothing from a sandbox without resources, or with a shape it does not know', () => {
    expect(sandboxResourceQuantities({})).toEqual({});
    expect(
      sandboxResourceQuantities({
        template: { resources: { limits: 'lots', requests: { cpu: {} } } },
      }),
    ).toEqual({});
  });
});

describe('userAnnotations', () => {
  it('leaves out the annotations the gateway keeps for itself', () => {
    expect(
      userAnnotations({
        owner: 'ml-team',
        'internal.openshell.ai/compute-driver': 'docker',
        'internal.openshell.ai/runtime-generation': 'fec837c3',
        'example.com/internal.openshell.ai/note': 'kept',
      }),
    ).toEqual({
      owner: 'ml-team',
      'example.com/internal.openshell.ai/note': 'kept',
    });
  });

  it('reads a sandbox without annotations as having none', () => {
    expect(userAnnotations(undefined)).toEqual({});
  });
});

describe('formatGpuRequest', () => {
  it('shows a count, the driver default, or none', () => {
    expect(formatGpuRequest({ gpu: true, gpuCount: 2 })).toBe('2');
    expect(formatGpuRequest({ gpu: true })).toBe('Driver default');
    expect(formatGpuRequest({})).toBe('-');
  });
});
