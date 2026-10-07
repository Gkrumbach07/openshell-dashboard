import {
  DEFAULT_TERMINAL_SESSION_OPTIONS,
  terminalStartMessage,
} from '../terminalSession';

describe('terminalStartMessage', () => {
  it('sends only the type when nothing was chosen', () => {
    expect(terminalStartMessage(DEFAULT_TERMINAL_SESSION_OPTIONS)).toEqual({
      message: { type: 'start' },
    });
  });

  it('reads the command as one argument per line, exactly as typed', () => {
    const { message } = terminalStartMessage({
      ...DEFAULT_TERMINAL_SESSION_OPTIONS,
      commandText: '/bin/sh\n-c\necho "a b" && pwd\n',
    });
    expect(message.command).toEqual(['/bin/sh', '-c', 'echo "a b" && pwd']);
  });

  it('carries the working directory, the environment and the login-shell choice', () => {
    expect(
      terminalStartMessage({
        commandText: '',
        workdir: '  /sandbox/project ',
        environmentRows: [
          { key: 'MODE', value: 'ci' },
          { key: '', value: '' },
          { key: 'EMPTY', value: '' },
        ],
        noLoginShell: true,
      }),
    ).toEqual({
      message: {
        type: 'start',
        workdir: '/sandbox/project',
        environment: { MODE: 'ci', EMPTY: '' },
        noLoginShell: true,
      },
    });
  });

  it('refuses a value without a name instead of dropping it', () => {
    const { error } = terminalStartMessage({
      ...DEFAULT_TERMINAL_SESSION_OPTIONS,
      environmentRows: [{ key: '', value: 'orphan' }],
    });
    expect(error).toBe('Every value needs a name');
  });

  it('refuses a variable named twice', () => {
    const { error } = terminalStartMessage({
      ...DEFAULT_TERMINAL_SESSION_OPTIONS,
      environmentRows: [
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ],
    });
    expect(error).toBe('"A" is listed more than once');
  });
});
