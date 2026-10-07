import { useState } from 'react';
import {
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  FormGroup,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';

import {
  DEFAULT_FORWARD_PORT,
  LOCAL_PATH_PLACEHOLDER,
  PORT_PLACEHOLDER,
  SANDBOX_PATH_PLACEHOLDER,
  cliPort,
  sandboxCliCommands,
} from '../utils/cliCommands';

type ConnectCardProps = {
  sandboxName: string;
  // The workspace the sandbox is in. Every command then carries
  // `--workspace`; without it the CLI looks in $OPENSHELL_WORKSPACE, or in
  // "default".
  workspace?: string;
};

type Command = {
  id: string;
  // What the command does, read out for the copy field.
  label: string;
  command: string;
};

const CommandList: React.FC<{ commands: Command[] }> = ({ commands }) => (
  <Stack hasGutter>
    {commands.map(({ id, label, command }) => (
      <StackItem key={id}>
        <Content component="small">{label}</Content>
        <ClipboardCopy
          isReadOnly
          hoverTip="Copy"
          clickTip="Copied"
          textAriaLabel={label}
          data-testid={`connect-command-${id}`}
        >
          {command}
        </ClipboardCopy>
      </StackItem>
    ))}
  </Stack>
);

// An SSH session, an editor attached to the sandbox, a port forward and a
// directory sync all need something running on the user's machine, so the
// dashboard hands them to the OpenShell CLI. The command lines follow the CLI
// of OpenShell v0.1.2; see utils/cliCommands.ts.
const ConnectCard: React.FC<ConnectCardProps> = ({
  sandboxName,
  workspace,
}) => {
  const [port, setPort] = useState(DEFAULT_FORWARD_PORT);
  const commands = sandboxCliCommands({ workspace, sandboxName }, port);
  // Not a port: the forward commands show a placeholder until it is one.
  const needsPort = cliPort(port) === PORT_PLACEHOLDER;

  return (
    <Card data-testid="connect-card">
      <CardTitle>Connect via CLI</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <Content component="p">
              Interactive sessions run through the OpenShell CLI. These commands
              use the gateway that is active in the CLI. To use another one, add{' '}
              <code>--gateway NAME</code> after <code>openshell</code>, or make
              it the active one with <code>openshell gateway select NAME</code>.
            </Content>
          </StackItem>
          <StackItem>
            <DescriptionList>
              <DescriptionListGroup>
                <DescriptionListTerm>Shell</DescriptionListTerm>
                <DescriptionListDescription>
                  <CommandList
                    commands={[
                      {
                        id: 'connect',
                        label: 'Open an interactive shell over SSH',
                        command: commands.connect,
                      },
                      {
                        id: 'exec',
                        label: 'Run a one-off command',
                        command: commands.exec,
                      },
                    ]}
                  />
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Editor</DescriptionListTerm>
                <DescriptionListDescription>
                  <CommandList
                    commands={[
                      {
                        id: 'connect-vscode',
                        label: 'Open the sandbox in VS Code',
                        command: commands.connectVscode,
                      },
                      {
                        id: 'connect-cursor',
                        label: 'Open the sandbox in Cursor',
                        command: commands.connectCursor,
                      },
                    ]}
                  />
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>SSH config</DescriptionListTerm>
                <DescriptionListDescription>
                  <CommandList
                    commands={[
                      {
                        id: 'ssh-config',
                        label:
                          'Print a Host entry to append to ~/.ssh/config, for Remote-SSH and other SSH tools',
                        command: commands.sshConfig,
                      },
                      ...(commands.ssh
                        ? [
                            {
                              id: 'ssh',
                              label: 'Connect with ssh once the entry is added',
                              command: commands.ssh,
                            },
                          ]
                        : []),
                    ]}
                  />
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Port forwarding</DescriptionListTerm>
                <DescriptionListDescription>
                  <Stack hasGutter>
                    <StackItem>
                      <FormGroup label="Port" fieldId="connect-forward-port">
                        <TextInput
                          id="connect-forward-port"
                          data-testid="connect-forward-port"
                          type="number"
                          value={port}
                          onChange={(_event, value) => setPort(value)}
                          validated={needsPort ? 'error' : 'default'}
                        />
                      </FormGroup>
                    </StackItem>
                    <StackItem>
                      <CommandList
                        commands={[
                          {
                            id: 'forward-start',
                            label:
                              'Forward the local port to the same port in the sandbox, over SSH',
                            command: commands.forwardStart,
                          },
                          {
                            id: 'forward-start-background',
                            label: 'Forward in the background',
                            command: commands.forwardStartBackground,
                          },
                          {
                            id: 'forward-stop',
                            label: 'Stop a background forward',
                            command: commands.forwardStop,
                          },
                          {
                            id: 'forward-list',
                            label: 'List the forwards tracked on this machine',
                            command: commands.forwardList,
                          },
                          {
                            id: 'forward-service',
                            label:
                              'Forward the local port to a service on the sandbox loopback, over gRPC',
                            command: commands.forwardService,
                          },
                        ]}
                      />
                    </StackItem>
                  </Stack>
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Directory sync</DescriptionListTerm>
                <DescriptionListDescription>
                  <Stack hasGutter>
                    <StackItem>
                      <CommandList
                        commands={[
                          {
                            id: 'upload',
                            label: `Upload a local file or directory (replace ${LOCAL_PATH_PLACEHOLDER})`,
                            command: commands.upload,
                          },
                          {
                            id: 'download',
                            label: `Download a file or directory from the sandbox (replace ${SANDBOX_PATH_PLACEHOLDER})`,
                            command: commands.download,
                          },
                        ]}
                      />
                    </StackItem>
                    <StackItem>
                      <Content component="small">
                        Both take an optional destination as a last argument.
                        Upload skips files matched by .gitignore unless{' '}
                        <code>--no-git-ignore</code> is added.
                      </Content>
                    </StackItem>
                  </Stack>
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  );
};

export default ConnectCard;
