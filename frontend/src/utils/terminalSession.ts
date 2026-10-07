import { parseCommand, rowsToRecord } from './sandboxOptions';
import type { KeyValueRow } from './sandboxOptions';

// What the Terminal tab lets a user choose before a session starts: the
// options of `openshell sandbox exec`.
export type TerminalSessionOptions = {
  // One argument per line. Empty runs the default shell.
  commandText: string;
  workdir: string;
  environmentRows: KeyValueRow[];
  noLoginShell: boolean;
};

export const DEFAULT_TERMINAL_SESSION_OPTIONS: TerminalSessionOptions = {
  commandText: '',
  workdir: '',
  environmentRows: [],
  noLoginShell: false,
};

// The first frame of a terminal socket opened with ?start=message. Only what
// was chosen is sent; an option left out keeps the gateway's default.
export type TerminalStartMessage = {
  type: 'start';
  command?: string[];
  workdir?: string;
  environment?: Record<string, string>;
  noLoginShell?: boolean;
};

export const terminalStartMessage = (
  options: TerminalSessionOptions,
): { message: TerminalStartMessage; error?: string } => {
  const message: TerminalStartMessage = { type: 'start' };

  const command = parseCommand(options.commandText);
  if (command.length > 0) {
    message.command = command;
  }
  const workdir = options.workdir.trim();
  if (workdir) {
    message.workdir = workdir;
  }
  const { record, error } = rowsToRecord(options.environmentRows);
  if (error) {
    return { message, error };
  }
  if (Object.keys(record).length > 0) {
    message.environment = record;
  }
  if (options.noLoginShell) {
    message.noLoginShell = true;
  }
  return { message };
};
