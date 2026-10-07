import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ConnectCard from '../ConnectCard';

// The command line a copy field holds.
const command = (id: string): string => {
  const field = screen.getByTestId(`connect-command-${id}`);
  return (within(field).getByRole('textbox') as HTMLInputElement).value;
};

describe('ConnectCard', () => {
  it('renders the card', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(screen.getByTestId('connect-card')).toBeInTheDocument();
  });

  it('renders the connect via CLI title', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(screen.getByText('Connect via CLI')).toBeInTheDocument();
  });

  it('includes the sandbox connect command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const connectInput = inputs.find((i) =>
      i.value.includes('openshell sandbox connect my-agent'),
    );
    expect(connectInput).toBeTruthy();
  });

  it('includes the exec command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const execInput = inputs.find((i) =>
      i.value.includes('openshell sandbox exec -n my-agent'),
    );
    expect(execInput).toBeTruthy();
  });

  it('includes the ssh-config command in an input', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const sshInput = inputs.find((i) =>
      i.value.includes('openshell sandbox ssh-config my-agent'),
    );
    expect(sshInput).toBeTruthy();
  });

  it('renders descriptive text about CLI sessions', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(
      screen.getByText(/Interactive sessions run through the OpenShell CLI/),
    ).toBeInTheDocument();
  });

  // Everything the CLI can do with a sandbox that a browser cannot: a shell,
  // an editor, an SSH config entry, port forwards and directory sync.
  it('fills every command in with the workspace and the sandbox', () => {
    render(<ConnectCard sandboxName="my-agent" workspace="team-a" />);

    expect(command('connect')).toBe(
      'openshell --workspace team-a sandbox connect my-agent',
    );
    expect(command('exec')).toBe(
      'openshell --workspace team-a sandbox exec -n my-agent -- ls -la',
    );
    expect(command('connect-vscode')).toBe(
      'openshell --workspace team-a sandbox connect my-agent --editor vscode',
    );
    expect(command('connect-cursor')).toBe(
      'openshell --workspace team-a sandbox connect my-agent --editor cursor',
    );
    expect(command('ssh-config')).toBe(
      'openshell --workspace team-a sandbox ssh-config my-agent',
    );
    expect(command('ssh')).toBe('ssh openshell-my-agent.team-a');
    expect(command('forward-start')).toBe(
      'openshell --workspace team-a forward start 8080 my-agent',
    );
    expect(command('forward-start-background')).toBe(
      'openshell --workspace team-a forward start 8080 my-agent --background',
    );
    expect(command('forward-stop')).toBe(
      'openshell --workspace team-a forward stop 8080 my-agent',
    );
    expect(command('forward-list')).toBe('openshell forward list');
    expect(command('forward-service')).toBe(
      'openshell --workspace team-a forward service my-agent --target-port 8080',
    );
    expect(command('upload')).toBe(
      'openshell --workspace team-a sandbox upload my-agent LOCAL_PATH',
    );
    expect(command('download')).toBe(
      'openshell --workspace team-a sandbox download my-agent SANDBOX_PATH',
    );
  });

  it('says what each command does', () => {
    render(<ConnectCard sandboxName="my-agent" workspace="team-a" />);
    for (const label of [
      'Open an interactive shell over SSH',
      'Open the sandbox in VS Code',
      'Open the sandbox in Cursor',
      'Stop a background forward',
      'List the forwards tracked on this machine',
    ]) {
      // The label is both the visible caption and the name of the field.
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: label })).toBeInTheDocument();
    }
  });

  it('names the gateway flag for a gateway that is not the active one', () => {
    render(<ConnectCard sandboxName="my-agent" workspace="team-a" />);
    expect(screen.getByText('--gateway NAME')).toBeInTheDocument();
    expect(
      screen.getByText('openshell gateway select NAME'),
    ).toBeInTheDocument();
  });

  // Without a workspace the CLI falls back to $OPENSHELL_WORKSPACE or
  // "default", and the ssh alias cannot be named.
  it('leaves the workspace flag out when it is not given one', () => {
    render(<ConnectCard sandboxName="my-agent" />);
    expect(command('connect')).toBe('openshell sandbox connect my-agent');
    expect(command('forward-start')).toBe(
      'openshell forward start 8080 my-agent',
    );
    expect(screen.queryByTestId('connect-command-ssh')).not.toBeInTheDocument();
  });

  it('puts the port that is typed into the forward commands', () => {
    render(<ConnectCard sandboxName="my-agent" workspace="team-a" />);
    const port = screen.getByTestId('connect-forward-port');
    expect(port).toHaveValue(8080);

    fireEvent.change(port, { target: { value: '3000' } });

    expect(command('forward-start')).toBe(
      'openshell --workspace team-a forward start 3000 my-agent',
    );
    expect(command('forward-stop')).toBe(
      'openshell --workspace team-a forward stop 3000 my-agent',
    );
    expect(command('forward-service')).toBe(
      'openshell --workspace team-a forward service my-agent --target-port 3000',
    );
    // The other commands have no port in them.
    expect(command('connect')).toBe(
      'openshell --workspace team-a sandbox connect my-agent',
    );
    expect(port).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('marks a port that is out of range and shows a placeholder', () => {
    render(<ConnectCard sandboxName="my-agent" workspace="team-a" />);
    const port = screen.getByTestId('connect-forward-port');

    fireEvent.change(port, { target: { value: '70000' } });

    expect(port).toHaveAttribute('aria-invalid', 'true');
    expect(command('forward-start')).toBe(
      'openshell --workspace team-a forward start PORT my-agent',
    );
  });
});
