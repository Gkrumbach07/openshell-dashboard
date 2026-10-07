import { cliPort, sandboxCliCommands } from '../cliCommands';

// The expected strings are written out in full: they are what a user pastes
// into a shell, and each one was checked against the clap definitions in
// crates/openshell-cli/src/main.rs at v0.1.2.
describe('sandboxCliCommands', () => {
  it('carries the workspace as the global --workspace flag', () => {
    expect(
      sandboxCliCommands({ workspace: 'team-a', sandboxName: 'my-agent' }),
    ).toEqual({
      connect: 'openshell --workspace team-a sandbox connect my-agent',
      connectVscode:
        'openshell --workspace team-a sandbox connect my-agent --editor vscode',
      connectCursor:
        'openshell --workspace team-a sandbox connect my-agent --editor cursor',
      exec: 'openshell --workspace team-a sandbox exec -n my-agent -- ls -la',
      sshConfig: 'openshell --workspace team-a sandbox ssh-config my-agent',
      ssh: 'ssh openshell-my-agent.team-a',
      forwardStart: 'openshell --workspace team-a forward start 8080 my-agent',
      forwardStartBackground:
        'openshell --workspace team-a forward start 8080 my-agent --background',
      forwardStop: 'openshell --workspace team-a forward stop 8080 my-agent',
      forwardList: 'openshell forward list',
      forwardService:
        'openshell --workspace team-a forward service my-agent --target-port 8080',
      upload: 'openshell --workspace team-a sandbox upload my-agent LOCAL_PATH',
      download:
        'openshell --workspace team-a sandbox download my-agent SANDBOX_PATH',
    });
  });

  // "default" is only the CLI's fallback: $OPENSHELL_WORKSPACE overrides it,
  // so the flag is written out for the default workspace too.
  it('names the default workspace as well', () => {
    const commands = sandboxCliCommands({
      workspace: 'default',
      sandboxName: 'my-agent',
    });
    expect(commands.connect).toBe(
      'openshell --workspace default sandbox connect my-agent',
    );
    expect(commands.ssh).toBe('ssh openshell-my-agent.default');
  });

  it('leaves the flag out when the workspace is not known', () => {
    const commands = sandboxCliCommands({ sandboxName: 'my-agent' });
    expect(commands.connect).toBe('openshell sandbox connect my-agent');
    expect(commands.exec).toBe('openshell sandbox exec -n my-agent -- ls -la');
    expect(commands.sshConfig).toBe('openshell sandbox ssh-config my-agent');
    expect(commands.forwardStart).toBe('openshell forward start 8080 my-agent');
    expect(commands.upload).toBe(
      'openshell sandbox upload my-agent LOCAL_PATH',
    );
    // The ssh Host alias contains the workspace, so there is none to give.
    expect(commands.ssh).toBeUndefined();
    for (const command of Object.values(commands)) {
      expect(command ?? '').not.toContain('--workspace');
    }
  });

  it('puts the workspace flag ahead of the subcommand in every command', () => {
    const commands = sandboxCliCommands({
      workspace: 'team-a',
      sandboxName: 'my-agent',
    });
    const { ssh, forwardList, ...scoped } = commands;
    expect(ssh).toBeDefined();
    // Lists the forwards of every workspace this machine tracks.
    expect(forwardList).not.toContain('--workspace');
    for (const command of Object.values(scoped)) {
      expect(command).toMatch(/^openshell --workspace team-a /);
    }
    // `--` ends the flags of `sandbox exec`: a flag after it would be handed
    // to the command that runs in the sandbox.
    expect(commands.exec.indexOf('--workspace')).toBeLessThan(
      commands.exec.indexOf(' -- '),
    );
  });

  it('uses the port it is given in the forward commands only', () => {
    const commands = sandboxCliCommands(
      { workspace: 'team-a', sandboxName: 'my-agent' },
      '3000',
    );
    expect(commands.forwardStart).toBe(
      'openshell --workspace team-a forward start 3000 my-agent',
    );
    expect(commands.forwardStartBackground).toBe(
      'openshell --workspace team-a forward start 3000 my-agent --background',
    );
    expect(commands.forwardStop).toBe(
      'openshell --workspace team-a forward stop 3000 my-agent',
    );
    expect(commands.forwardService).toBe(
      'openshell --workspace team-a forward service my-agent --target-port 3000',
    );
    expect(commands.connect).not.toContain('3000');
  });

  it('shows a placeholder until the port is one', () => {
    const commands = sandboxCliCommands({ sandboxName: 'my-agent' }, 'http');
    expect(commands.forwardStart).toBe('openshell forward start PORT my-agent');
    expect(commands.forwardService).toBe(
      'openshell forward service my-agent --target-port PORT',
    );
  });
});

describe('cliPort', () => {
  it.each([
    ['8080', '8080'],
    [' 3000 ', '3000'],
    ['1', '1'],
    ['65535', '65535'],
    // Leading zeros are not part of a port.
    ['0080', '80'],
  ])('reads %j as port %s', (input, expected) => {
    expect(cliPort(input)).toBe(expected);
  });

  it.each(['', '0', '65536', '-1', '80.5', '8080;rm -rf /', 'abc', '1e3'])(
    'does not take %j for a port',
    (input) => {
      expect(cliPort(input)).toBe('PORT');
    },
  );
});
