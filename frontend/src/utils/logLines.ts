import type { LogLine } from '../types';

// How a sandbox's log lines are shown. The order of a line's fields and what
// is coloured follow the log view of the upstream TUI (openshell-tui,
// ui/sandbox_logs.rs at v0.1.2), so a line reads the same in both.

// The fields of a CONNECT decision, most telling first. The process ancestry
// (binary to ancestors) trails the network half.
const CONNECT_FIELD_ORDER = [
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

// The fields of an L7_REQUEST decision, most telling first.
const L7_FIELD_ORDER = [
  'l7_action',
  'l7_target',
  'l7_decision',
  'dst_host',
  'dst_port',
  'l7_protocol',
  'policy',
  'l7_deny_reason',
];

export type LogField = [key: string, value: string];

// Orders two keys the way the TUI's sort does: by Unicode code point. The
// default string comparison goes by UTF-16 code unit, which places a
// character outside the Basic Multilingual Plane before some inside it.
const compareKeys = (a: string, b: string): number => {
  const left = Array.from(a, (char) => char.codePointAt(0) ?? 0);
  const right = Array.from(b, (char) => char.codePointAt(0) ?? 0);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return left.length - right.length;
};

// The fields of a log line in the order they are read in.
//
// A message that starts with CONNECT (the L4 decision, and CONNECT_L7, the
// tunnel of an L7 endpoint) or with L7_REQUEST has its known fields first, in
// a fixed order, and whatever else it carries after them in alphabetical
// order. Every other message has its fields in alphabetical order.
//
// Nothing is dropped here: a field without a value is still a field. What is
// shown leaves those out, see shownLogFields.
export const orderedLogFields = (
  message: string,
  fields: Record<string, string> | undefined,
): LogField[] => {
  const all = Object.entries(fields ?? {});
  const alphabetical = (entries: LogField[]): LogField[] =>
    [...entries].sort(([a], [b]) => compareKeys(a, b));

  let priority: string[] | undefined;
  if (message.startsWith('CONNECT')) {
    priority = CONNECT_FIELD_ORDER;
  } else if (message.startsWith('L7_REQUEST')) {
    priority = L7_FIELD_ORDER;
  }
  if (!priority) {
    return alphabetical(all);
  }

  const byKey = new Map(all);
  const first: LogField[] = [];
  for (const key of priority) {
    const value = byKey.get(key);
    if (value !== undefined) {
      first.push([key, value]);
      byKey.delete(key);
    }
  }
  return [...first, ...alphabetical([...byKey.entries()])];
};

// The fields that are shown for a log line: in order, without the ones that
// have no value.
export const shownLogFields = (line: LogLine): LogField[] =>
  orderedLogFields(line.message, line.fields).filter(
    ([, value]) => value !== '',
  );

// The level as it is shown. A line without one is a plain log line.
export const logLevelOf = (line: LogLine): string =>
  (line.level || 'LOG').toUpperCase();

// The time of day a line was logged at, in the viewer's own time zone. A line
// without a timestamp has none to show.
export const formatLogTime = (timestampMs: number): string =>
  timestampMs > 0 ? new Date(timestampMs).toLocaleTimeString() : '--:--:--';

// ANSI colour sequences. The log viewer renders them (it runs every row
// through ansi_up), which is the one way to colour part of a row: a row is
// text, not markup.
const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const RED = `${ESC}[91m`;
const YELLOW = `${ESC}[33m`;
const GREEN = `${ESC}[32m`;
const CYAN = `${ESC}[36m`;

// ERROR, WARN and INFO are coloured; every other level is left as it is.
const LEVEL_COLOURS: Record<string, string> = {
  ERROR: RED,
  WARN: YELLOW,
  INFO: GREEN,
};

const coloured = (text: string, colour: string | undefined): string =>
  colour ? `${colour}${text}${RESET}` : text;

// What a log line says came from a sandbox or the gateway, not from this
// page, so it must not be able to colour itself: a line that carried its own
// escape sequences could pass itself off as another level, or leave a colour
// switched on for the rows after it. Each escape character is shown as the
// symbol for one instead, which keeps what the line contained visible.
const CONTROL_SEQUENCE_INTRODUCER = '\u009b';
const ESCAPE_SYMBOL = '␛';
const withoutEscapes = (text: string): string =>
  text
    .split(ESC)
    .join(ESCAPE_SYMBOL)
    .split(CONTROL_SEQUENCE_INTRODUCER)
    .join(ESCAPE_SYMBOL);

type FormatOptions = {
  // Colour the level and accent the sandbox source. Off for plain text.
  colour?: boolean;
};

// One log line as text: time, level, source and target, then the message and
// its fields. This is what a line of `openshell logs` carries.
export const formatLogLine = (
  line: LogLine,
  { colour = false }: FormatOptions = {},
): string => {
  const level = logLevelOf(line);
  const levelText = withoutEscapes(level);
  const sourceText = line.source ? `[${withoutEscapes(line.source)}]` : '';
  const target = line.target ? ` [${withoutEscapes(line.target)}]` : '';
  const fields = shownLogFields(line)
    .map(([key, value]) => ` ${withoutEscapes(key)}=${withoutEscapes(value)}`)
    .join('');

  const shownLevel = colour
    ? coloured(levelText, LEVEL_COLOURS[level])
    : levelText;
  const shownSource =
    colour && line.source === 'sandbox'
      ? coloured(sourceText, CYAN)
      : sourceText;
  const source = shownSource ? ` ${shownSource}` : '';

  return `${formatLogTime(line.timestampMs)}  ${shownLevel}${source}${target}  ${withoutEscapes(line.message)}${fields}`;
};

// The rows a log viewer shows for a list of log lines, and which line each
// row belongs to. A message that spans several lines takes several rows, so
// the two do not count alike: lineOfRow[row] is the index of that row's line.
export type LogRows = {
  text: string;
  lineOfRow: number[];
};

export const buildLogRows = (
  lines: LogLine[],
  options: FormatOptions = {},
): LogRows => {
  const rows: string[] = [];
  const lineOfRow: number[] = [];
  lines.forEach((line, index) => {
    for (const row of formatLogLine(line, options).split('\n')) {
      rows.push(row);
      lineOfRow.push(index);
    }
  });
  return { text: rows.join('\n'), lineOfRow };
};

// The class names of a row of the PatternFly log viewer and of the line
// number in front of it. The viewer has no row callback, so the row a click
// landed in is read from its markup.
const LOG_VIEWER_ROW = '.pf-v6-c-log-viewer__list-item';
const LOG_VIEWER_ROW_NUMBER = '.pf-v6-c-log-viewer__index';

// The zero-based row of the log viewer that an event came from, or undefined
// when it came from somewhere else. The viewer numbers its rows from one.
export const logViewerRowOf = (
  target: EventTarget | null,
): number | undefined => {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const number = target
    .closest(LOG_VIEWER_ROW)
    ?.querySelector(LOG_VIEWER_ROW_NUMBER)?.textContent;
  if (!number || !/^\d+$/.test(number.trim())) {
    return undefined;
  }
  const row = Number(number) - 1;
  return row >= 0 ? row : undefined;
};
