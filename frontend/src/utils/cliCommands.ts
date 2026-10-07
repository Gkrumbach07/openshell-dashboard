// Command lines for the OpenShell CLI, for the things a browser cannot do:
// an SSH session, an editor attached to the sandbox, a port forward, and
// syncing a directory. They are written against the CLI of OpenShell v0.1.2
// (crates/openshell-cli/src/main.rs at that tag); the comment on each one
// names the clap definition it follows.

// What stands in for a value only the user knows.
export const LOCAL_PATH_PLACEHOLDER = 'LOCAL_PATH';
export const SANDBOX_PATH_PLACEHOLDER = 'SANDBOX_PATH';
export const PORT_PLACEHOLDER = 'PORT';

// The port the CLI's own `forward` examples use.
export const DEFAULT_FORWARD_PORT = '8080';

export type SandboxCliTarget = {
  // The CLI's global `--workspace` flag. Without it the CLI uses
  // $OPENSHELL_WORKSPACE, and "default" when that is unset, so a command for
  // a sandbox anywhere else has to carry it.
  workspace?: string;
  sandboxName: string;
};

export type SandboxCliCommands = {
  connect: string;
  connectVscode: string;
  connectCursor: string;
  exec: string;
  sshConfig: string;
  // The Host alias `sandbox ssh-config` writes. It contains the workspace, so
  // there is none to give when the workspace is not known.
  ssh?: string;
  forwardStart: string;
  forwardStartBackground: string;
  forwardStop: string;
  forwardList: string;
  forwardService: string;
  upload: string;
  download: string;
};

// A TCP port as the CLI takes it (`forward stop` and `forward service` parse a
// u16), or the placeholder when the input is not one.
export const cliPort = (input: string): string => {
  const trimmed = input.trim();
  if (!/^\d{1,5}$/.test(trimmed)) {
    return PORT_PLACEHOLDER;
  }
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? String(port) : PORT_PLACEHOLDER;
};

export const sandboxCliCommands = (
  { workspace, sandboxName }: SandboxCliTarget,
  port: string = DEFAULT_FORWARD_PORT,
): SandboxCliCommands => {
  // `--workspace` is a global flag (`global = true` on `Cli.workspace`), so it
  // is accepted in front of the subcommand, which keeps it clear of the
  // `--` that ends the flags of `sandbox exec`.
  const openshell = workspace
    ? `openshell --workspace ${workspace}`
    : 'openshell';
  const forwardPort = cliPort(port);
  return {
    // SandboxCommands::Connect { name, --editor <vscode|cursor> }
    connect: `${openshell} sandbox connect ${sandboxName}`,
    connectVscode: `${openshell} sandbox connect ${sandboxName} --editor vscode`,
    connectCursor: `${openshell} sandbox connect ${sandboxName} --editor cursor`,
    // SandboxCommands::Exec { -n/--name, command after the flags }
    exec: `${openshell} sandbox exec -n ${sandboxName} -- ls -la`,
    // SandboxCommands::SshConfig { name }; the alias is ssh.rs host_alias().
    sshConfig: `${openshell} sandbox ssh-config ${sandboxName}`,
    ssh: workspace ? `ssh openshell-${sandboxName}.${workspace}` : undefined,
    // ForwardCommands::Start { port, name, -d/--background }
    forwardStart: `${openshell} forward start ${forwardPort} ${sandboxName}`,
    forwardStartBackground: `${openshell} forward start ${forwardPort} ${sandboxName} --background`,
    // ForwardCommands::Stop { port, name }
    forwardStop: `${openshell} forward stop ${forwardPort} ${sandboxName}`,
    // ForwardCommands::List: every forward this machine tracks, whatever its
    // workspace, so it takes no workspace.
    forwardList: 'openshell forward list',
    // ForwardCommands::Service { name, --target-port, --target-host, --local }
    forwardService: `${openshell} forward service ${sandboxName} --target-port ${forwardPort}`,
    // SandboxCommands::Upload { name, local_path, dest, --no-git-ignore }
    upload: `${openshell} sandbox upload ${sandboxName} ${LOCAL_PATH_PLACEHOLDER}`,
    // SandboxCommands::Download { name, sandbox_path, dest }
    download: `${openshell} sandbox download ${sandboxName} ${SANDBOX_PATH_PLACEHOLDER}`,
  };
};
