import {
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  Content,
  Stack,
  StackItem,
} from '@patternfly/react-core';

type ConnectCardProps = {
  sandboxName: string;
};

// Interactive shells need bidirectional streaming, which doesn't work
// through the federated proxy — so the dashboard hands off to the CLI.
const ConnectCard: React.FC<ConnectCardProps> = ({ sandboxName }) => (
  <Card data-testid="connect-card">
    <CardTitle>Connect via CLI</CardTitle>
    <CardBody>
      <Stack hasGutter>
        <StackItem>
          <Content component="p">
            Interactive sessions run through the OpenShell CLI. With the CLI installed and this
            gateway selected:
          </Content>
        </StackItem>
        <StackItem>
          <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied">
            {`openshell sandbox connect ${sandboxName}`}
          </ClipboardCopy>
        </StackItem>
        <StackItem>
          <Content component="p">Run a one-off command:</Content>
          <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied">
            {`openshell sandbox exec -n ${sandboxName} -- ls -la`}
          </ClipboardCopy>
        </StackItem>
        <StackItem>
          <Content component="p">SSH config for editors (VS Code Remote-SSH, Cursor):</Content>
          <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied">
            {`openshell sandbox ssh-config ${sandboxName}`}
          </ClipboardCopy>
        </StackItem>
      </Stack>
    </CardBody>
  </Card>
);

export default ConnectCard;
