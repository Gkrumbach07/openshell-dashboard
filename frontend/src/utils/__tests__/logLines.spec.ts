import {
  buildLogRows,
  formatLogLine,
  formatLogTime,
  logLevelOf,
  logViewerRowOf,
  orderedLogFields,
  shownLogFields,
} from '../logLines';
import type { LogLine } from '../../types';

const line = (
  message: string,
  fields?: Record<string, string>,
  more: Partial<LogLine> = {},
): LogLine => ({
  timestampMs: 1_700_000_000_000,
  level: 'INFO',
  source: 'sandbox',
  target: 'test',
  message,
  fields,
  ...more,
});

const keys = (message: string, fields: Record<string, string>): string[] =>
  orderedLogFields(message, fields).map(([key]) => key);

// The escape character, and the sequences the log viewer turns into colour.
const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const RED = `${ESC}[91m`;
const YELLOW = `${ESC}[33m`;
const GREEN = `${ESC}[32m`;
const CYAN = `${ESC}[36m`;

// The time of day is shown in the viewer's own time zone and locale, so the
// tests compare against what this machine prints rather than a literal.
const timeOf = (timestampMs: number): string =>
  new Date(timestampMs).toLocaleTimeString();

// Every key the TUI puts first for a CONNECT line, in the order it puts them.
const CONNECT_ORDER = [
  'action',
  'dst_host',
  'dst_port',
  'policy',
  'engine',
  'src_addr',
  'src_port',
  'binary',
  'binary_pid',
  'cmdline',
  'ancestors',
  'proxy_addr',
  'reason',
];

// And for an L7_REQUEST line.
const L7_ORDER = [
  'l7_action',
  'l7_target',
  'l7_decision',
  'dst_host',
  'dst_port',
  'l7_protocol',
  'policy',
  'l7_deny_reason',
];

// The fields of a line given in the reverse of the wanted order, so that an
// implementation that keeps the order it was given cannot pass.
const reversed = (order: string[]): Record<string, string> =>
  Object.fromEntries([...order].reverse().map((key) => [key, `v-${key}`]));

describe('orderedLogFields', () => {
  it('puts the fields of a CONNECT line in the fixed order', () => {
    expect(keys('CONNECT', reversed(CONNECT_ORDER))).toEqual(CONNECT_ORDER);
  });

  it('puts the fields of an L7_REQUEST line in the fixed order', () => {
    expect(keys('L7_REQUEST', reversed(L7_ORDER))).toEqual(L7_ORDER);
  });

  // The message is matched by how it starts: CONNECT_L7 is the tunnel of an
  // L7 endpoint and reads like a CONNECT, and a message may go on after the
  // word.
  it.each([
    ['CONNECT_L7', CONNECT_ORDER],
    ['CONNECT allowed example.com:443', CONNECT_ORDER],
    ['L7_REQUEST GET /api', L7_ORDER],
  ])('orders a line that starts with %s the same way', (message, order) => {
    expect(keys(message, reversed(order))).toEqual(order);
  });

  it('puts the fields it has no place for after the known ones, alphabetically', () => {
    expect(
      keys('CONNECT', {
        zone: 'z',
        binary: '/usr/bin/curl',
        attempt: '2',
        action: 'allow',
        dst_host: 'example.com',
        matched: 'yes',
      }),
    ).toEqual(['action', 'dst_host', 'binary', 'attempt', 'matched', 'zone']);
  });

  it('leaves out of the fixed order what the line does not carry', () => {
    expect(
      keys('L7_REQUEST', { policy: 'default', l7_target: '/api' }),
    ).toEqual(['l7_target', 'policy']);
  });

  // The two orders belong to their own messages: l7_action is nothing
  // special on a CONNECT line and sorts with the rest.
  it('keeps the two fixed orders apart', () => {
    expect(
      keys('CONNECT', { l7_action: 'allow', reason: 'r', action: 'deny' }),
    ).toEqual(['action', 'reason', 'l7_action']);
    expect(
      keys('L7_REQUEST', { action: 'deny', reason: 'r', l7_action: 'allow' }),
    ).toEqual(['l7_action', 'action', 'reason']);
  });

  it.each([
    'SOMETHING',
    'connect',
    ' CONNECT',
    'NET:OPEN [INFO] 172.17.0.1:8080',
    '',
  ])('sorts the fields of "%s" alphabetically', (message) => {
    expect(
      keys(message, { zebra: 'z', action: 'a', alpha: 'a', dst_host: 'h' }),
    ).toEqual(['action', 'alpha', 'dst_host', 'zebra']);
  });

  // Upper case before lower case, digits before letters: by code point, as
  // the TUI's sort compares, and not as a dictionary would have it.
  it('sorts by code point', () => {
    expect(keys('x', { b: '', B: '', a: '', _x: '', '1': '', Z: '' })).toEqual([
      '1',
      'B',
      'Z',
      '_x',
      'a',
      'b',
    ]);
  });

  // A character outside the Basic Multilingual Plane has a higher code point
  // than every character inside it. Compared by UTF-16 code unit, as strings
  // are by default, it would come before U+FF5E.
  it('sorts a character beyond the BMP after every character inside it', () => {
    const beyond = '\u{1F600}';
    const inside = '～';
    expect(beyond < inside).toBe(true);
    expect(keys('x', { [beyond]: '', [inside]: '' })).toEqual([inside, beyond]);
  });

  it('sorts a key before a longer key that starts with it', () => {
    expect(keys('x', { dst_port: '', dst: '', dst_: '' })).toEqual([
      'dst',
      'dst_',
      'dst_port',
    ]);
  });

  // Ordering drops nothing: a field without a value is still a field.
  it('keeps a field that has no value, in its place', () => {
    expect(
      orderedLogFields('CONNECT', { reason: '', action: 'deny', aaa: '' }),
    ).toEqual([
      ['action', 'deny'],
      ['reason', ''],
      ['aaa', ''],
    ]);
  });

  it.each([[undefined], [null], [{}]])(
    'has nothing to order for a line whose fields are %p',
    (fields) => {
      expect(
        orderedLogFields(
          'CONNECT',
          fields as Record<string, string> | undefined,
        ),
      ).toEqual([]);
    },
  );

  // A field named like a property every object has is a field like any other.
  it('treats a key that an object inherits as a plain key', () => {
    const fields = JSON.parse(
      '{"constructor":"c","toString":"t","action":"deny"}',
    ) as Record<string, string>;
    expect(orderedLogFields('CONNECT', fields)).toEqual([
      ['action', 'deny'],
      ['constructor', 'c'],
      ['toString', 't'],
    ]);
    // And a line that does not carry such a field is not given one.
    expect(keys('CONNECT', { action: 'deny' })).toEqual(['action']);
  });

  it('does not change the fields it is given', () => {
    const fields = { zebra: 'z', action: 'a' };
    orderedLogFields('CONNECT', fields);
    expect(Object.keys(fields)).toEqual(['zebra', 'action']);
  });
});

describe('shownLogFields', () => {
  it('leaves out the fields that have no value', () => {
    expect(
      shownLogFields(
        line('CONNECT', { reason: '', action: 'deny', dst_host: '' }),
      ),
    ).toEqual([['action', 'deny']]);
  });

  it('keeps a value that is only blank, which is still a value', () => {
    expect(shownLogFields(line('x', { key: ' ' }))).toEqual([['key', ' ']]);
  });
});

describe('formatLogLine', () => {
  it('prints time, level, source, target, message and fields', () => {
    expect(
      formatLogLine(
        line('connection denied', { dst_host: 'example.com', action: 'deny' }),
      ),
    ).toBe(
      `${timeOf(1_700_000_000_000)}  INFO [sandbox] [test]  connection denied action=deny dst_host=example.com`,
    );
  });

  it('prints the fields of a CONNECT line in the fixed order, without the empty ones', () => {
    expect(
      formatLogLine(
        line('CONNECT', {
          binary: '/usr/bin/curl',
          reason: '',
          dst_host: 'example.com',
          action: 'allow',
        }),
      ),
    ).toBe(
      `${timeOf(1_700_000_000_000)}  INFO [sandbox] [test]  CONNECT action=allow dst_host=example.com binary=/usr/bin/curl`,
    );
  });

  it('leaves out what a line does not carry', () => {
    expect(
      formatLogLine({ timestampMs: 1_700_000_000_000, message: 'bare' }),
    ).toBe(`${timeOf(1_700_000_000_000)}  LOG  bare`);
  });

  it('shows a line without a timestamp as having none', () => {
    expect(formatLogTime(0)).toBe('--:--:--');
    expect(formatLogTime(-5)).toBe('--:--:--');
    expect(formatLogLine({ timestampMs: 0, message: 'fail' })).toBe(
      '--:--:--  LOG  fail',
    );
  });

  it('shows the level in upper case', () => {
    expect(logLevelOf(line('x', undefined, { level: 'warn' }))).toBe('WARN');
    expect(logLevelOf(line('x', undefined, { level: '' }))).toBe('LOG');
    expect(logLevelOf(line('x', undefined, { level: undefined }))).toBe('LOG');
  });

  describe('in colour', () => {
    const coloured = (more: Partial<LogLine>) =>
      formatLogLine(line('hello', undefined, more), { colour: true });

    it.each([
      ['ERROR', RED],
      ['WARN', YELLOW],
      ['INFO', GREEN],
      // The level is matched as it is shown, in upper case.
      ['error', RED],
    ])('colours the level %s', (level, colour) => {
      expect(coloured({ level, source: 'gateway' })).toBe(
        `${timeOf(1_700_000_000_000)}  ${colour}${level.toUpperCase()}${RESET} [gateway] [test]  hello`,
      );
    });

    it.each(['DEBUG', 'TRACE', 'OCSF', 'LOG', 'WARNING'])(
      'leaves the level %s as it is',
      (level) => {
        expect(coloured({ level, source: 'gateway' })).toBe(
          `${timeOf(1_700_000_000_000)}  ${level} [gateway] [test]  hello`,
        );
      },
    );

    it('accents the sandbox source and no other', () => {
      expect(coloured({ level: 'DEBUG', source: 'sandbox' })).toBe(
        `${timeOf(1_700_000_000_000)}  DEBUG ${CYAN}[sandbox]${RESET} [test]  hello`,
      );
      expect(coloured({ level: 'DEBUG', source: 'gateway' })).not.toContain(
        ESC,
      );
      expect(coloured({ level: 'DEBUG', source: undefined })).not.toContain(
        ESC,
      );
    });

    // Every colour that is switched on is switched off again in the same
    // row. The viewer carries colour over from one row to the next.
    it('ends every colour it starts', () => {
      const text = coloured({ level: 'ERROR', source: 'sandbox' });
      const starts = text.split(`${ESC}[`).length - 1;
      const resets = text.split(RESET).length - 1;
      expect(starts).toBe(4);
      expect(resets).toBe(2);
      expect(text.lastIndexOf(RESET)).toBeGreaterThan(text.lastIndexOf(CYAN));
    });

    it('says the same as the plain line once the colours are taken out', () => {
      const error = line(
        'CONNECT',
        { action: 'deny' },
        { level: 'ERROR', source: 'sandbox' },
      );
      const stripped = formatLogLine(error, { colour: true })
        .split(RED)
        .join('')
        .split(CYAN)
        .join('')
        .split(RESET)
        .join('');
      expect(stripped).toBe(formatLogLine(error));
    });
  });

  // What a line says comes from the sandbox or the gateway. If it could carry
  // escape sequences of its own it could colour itself as another level, or
  // leave a colour on for the rows below it.
  describe('with escape sequences in the line itself', () => {
    const hostile = line(
      `${RED}ERROR${RESET} fake`,
      { [`k${ESC}[32m`]: `v${ESC}[0m`, csi: '\u009b31m' },
      {
        level: 'DEBUG',
        source: `gate${ESC}[36mway`,
        target: `t${ESC}]8;;https://example.com${ESC}\\`,
      },
    );

    it.each([[false], [true]])(
      'shows them as text and not as colour (colour: %p)',
      (colour) => {
        const text = formatLogLine(hostile, { colour });
        expect(text).not.toContain(ESC);
        expect(text).not.toContain('\u009b');
        // What the line contained is still there to be read.
        expect(text).toContain('␛[91mERROR␛[0m fake');
        expect(text).toContain('[gate␛[36mway]');
        expect(text).toContain('csi=␛31m');
        expect(text).toContain('k␛[32m=v␛[0m');
      },
    );

    it('still colours a level that is one, and only with its own colour', () => {
      const text = formatLogLine(
        { ...hostile, level: 'WARN', source: 'sandbox' },
        { colour: true },
      );
      expect(text.split(ESC).length - 1).toBe(4);
      expect(text).toContain(`${YELLOW}WARN${RESET} ${CYAN}[sandbox]${RESET}`);
    });
  });
});

describe('buildLogRows', () => {
  it('has one row for each line and says which line a row belongs to', () => {
    const rows = buildLogRows([line('first'), line('second'), line('third')]);

    expect(rows.text.split('\n')).toHaveLength(3);
    expect(rows.text.split('\n')[1]).toBe(formatLogLine(line('second')));
    expect(rows.lineOfRow).toEqual([0, 1, 2]);
  });

  // The viewer starts a row at every line break, so a message that spans
  // lines takes rows the lines after it do not have.
  it('gives a message that spans lines a row for each, all of the same line', () => {
    const rows = buildLogRows([
      line('one'),
      line('two\n  continued\n  again'),
      line('three'),
    ]);

    expect(rows.text.split('\n')).toHaveLength(5);
    expect(rows.lineOfRow).toEqual([0, 1, 1, 1, 2]);
    expect(rows.text.split('\n')[2]).toBe('  continued');
  });

  it('has no rows for no lines', () => {
    expect(buildLogRows([])).toEqual({ text: '', lineOfRow: [] });
  });

  it('colours the rows when asked to', () => {
    expect(buildLogRows([line('x')], { colour: true }).text).toContain(GREEN);
    expect(buildLogRows([line('x')]).text).not.toContain(ESC);
  });
});

describe('logViewerRowOf', () => {
  // A row as the PatternFly log viewer draws it: the line number, then the
  // text, which may hold the spans of a colour or of a search match.
  const rowMarkup = (number: string) => `
    <div class="pf-v6-c-log-viewer__list-item">
      <span class="pf-v6-c-log-viewer__index">${number}</span>
      <span class="pf-v6-c-log-viewer__text">
        12:00:00 <span data-testid="inner-${number}">WARN</span> message
      </span>
    </div>`;

  const mount = (html: string): HTMLElement => {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the row of whatever was clicked inside it', () => {
    const viewer = mount(
      `<div class="pf-v6-c-log-viewer__list">${rowMarkup('1')}${rowMarkup('42')}</div>`,
    );
    const rows = viewer.querySelectorAll('.pf-v6-c-log-viewer__list-item');

    // The row itself, its line number, its text and a span inside its text.
    expect(logViewerRowOf(rows[1])).toBe(41);
    expect(
      logViewerRowOf(rows[1].querySelector('.pf-v6-c-log-viewer__index')),
    ).toBe(41);
    expect(
      logViewerRowOf(rows[1].querySelector('.pf-v6-c-log-viewer__text')),
    ).toBe(41);
    expect(
      logViewerRowOf(viewer.querySelector('[data-testid="inner-42"]')),
    ).toBe(41);
    expect(
      logViewerRowOf(viewer.querySelector('[data-testid="inner-1"]')),
    ).toBe(0);
  });

  it('finds no row for a click outside every row', () => {
    const viewer = mount(
      `<div class="pf-v6-c-log-viewer__header"><button>Search</button></div>
       <div class="pf-v6-c-log-viewer__list">${rowMarkup('1')}</div>`,
    );

    expect(logViewerRowOf(viewer.querySelector('button'))).toBeUndefined();
    expect(
      logViewerRowOf(viewer.querySelector('.pf-v6-c-log-viewer__list')),
    ).toBeUndefined();
    expect(logViewerRowOf(null)).toBeUndefined();
    expect(logViewerRowOf(document)).toBeUndefined();
  });

  it.each(['', 'abc', '0', '-3', '1.5'])(
    'finds no row when the line number reads "%s"',
    (number) => {
      const viewer = mount(rowMarkup(number));
      expect(
        logViewerRowOf(viewer.querySelector('.pf-v6-c-log-viewer__text')),
      ).toBeUndefined();
    },
  );

  it('finds no row when the row has no line number', () => {
    const viewer = mount(
      '<div class="pf-v6-c-log-viewer__list-item"><span class="pf-v6-c-log-viewer__text">x</span></div>',
    );
    expect(
      logViewerRowOf(viewer.querySelector('.pf-v6-c-log-viewer__text')),
    ).toBeUndefined();
  });
});
