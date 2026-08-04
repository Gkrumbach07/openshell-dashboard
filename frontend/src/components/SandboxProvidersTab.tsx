import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  FormSelect,
  FormSelectOption,
  Label,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { useProviders } from '../api/providers';
import {
  useAttachProvider,
  useAttachedProviders,
  useDetachProvider,
} from '../api/sandboxes';

type SandboxProvidersTabProps = {
  workspace: string;
  sandboxName: string;
};

// Attach/detach providers on a live sandbox. Mutations pass the sandbox's
// current resource_version for optimistic concurrency.
const SandboxProvidersTab: React.FC<SandboxProvidersTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const attached = useAttachedProviders(workspace, sandboxName);
  const workspaceProviders = useProviders(workspace);
  const attach = useAttachProvider(workspace, sandboxName);
  const detach = useDetachProvider(workspace, sandboxName);
  const [toAttach, setToAttach] = useState('');

  if (attached.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading attached providers" />
      </Bullseye>
    );
  }

  if (attached.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load attached providers"
        actionLinks={
          <Button variant="link" onClick={() => attached.refetch()}>
            Retry
          </Button>
        }
      >
        {(attached.error as Error).message}
      </Alert>
    );
  }

  const attachedRows = attached.data ?? [];
  const attachedNames = attachedRows.map((provider) => provider.metadata.name);
  const attachable = (workspaceProviders.data ?? []).filter(
    (provider) => !attachedNames.includes(provider.metadata.name),
  );

  return (
    <>
      <Toolbar aria-label="Provider actions">
        <ToolbarContent>
          <ToolbarItem>
            <FormSelect
              aria-label="Provider to attach"
              value={toAttach}
              onChange={(_event, value) => setToAttach(value)}
              data-testid="attach-provider-select"
            >
              <FormSelectOption
                value=""
                label="Select a provider to attach"
                isDisabled
              />
              {attachable.map((provider) => (
                <FormSelectOption
                  key={provider.metadata.name}
                  value={provider.metadata.name}
                  label={`${provider.metadata.name} (${provider.type})`}
                />
              ))}
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <Button
              onClick={() =>
                attach.mutate(
                  {
                    provider: toAttach,
                  },
                  { onSuccess: () => setToAttach('') },
                )
              }
              isDisabled={!toAttach || attach.isPending}
              isLoading={attach.isPending}
              data-testid="attach-provider-button"
            >
              Attach
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {(attach.isError || detach.isError) && (
        <Alert variant="danger" isInline title="Provider update failed">
          {((attach.error || detach.error) as Error).message}
        </Alert>
      )}
      <Table
        aria-label="Attached providers"
        variant="compact"
        data-testid="attached-providers-table"
      >
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Credentials</Th>
            <Th screenReaderText="Actions" />
          </Tr>
        </Thead>
        <Tbody>
          {attachedRows.map((provider) => (
            <Tr key={provider.metadata.name}>
              <Td dataLabel="Name">{provider.metadata.name}</Td>
              <Td dataLabel="Type">
                <Label color="purple">{provider.type}</Label>
              </Td>
              <Td dataLabel="Credentials">
                {(provider.credentialNames ?? []).join(', ') || '-'}
              </Td>
              <Td isActionCell>
                <ActionsColumn
                  items={[
                    {
                      title: 'Detach',
                      onClick: () => detach.mutate(provider.metadata.name),
                      isDisabled: detach.isPending,
                    },
                  ]}
                />
              </Td>
            </Tr>
          ))}
          {attachedRows.length === 0 && (
            <Tr>
              <Td colSpan={4}>No providers attached to this sandbox</Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </>
  );
};

export default SandboxProvidersTab;
