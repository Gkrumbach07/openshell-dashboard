import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  TextInput,
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
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

import {
  useDeleteService,
  useExposeService,
  useServices,
} from '../../api/sandboxes';
import RefreshErrorAlert, { isRefreshError } from '../RefreshErrorAlert';
import { serviceDisplayName } from '../ServiceEndpointsTable';

type SandboxServicesTabProps = {
  workspace: string;
  sandboxName: string;
};

// A loopback TCP port inside the sandbox: 1 to 65535.
const parsePort = (input: string): number | undefined => {
  if (!/^\d{1,5}$/.test(input.trim())) {
    return undefined;
  }
  const port = Number(input.trim());
  return port >= 1 && port <= 65535 ? port : undefined;
};

const SandboxServicesTab: React.FC<SandboxServicesTabProps> = ({
  workspace,
  sandboxName,
}) => {
  const services = useServices(workspace, sandboxName);
  const expose = useExposeService(workspace, sandboxName);
  const remove = useDeleteService(workspace, sandboxName);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const port = parsePort(targetPort);

  const resetModal = () => {
    setServiceName('');
    setTargetPort('');
    setIsModalOpen(false);
  };

  // The request `openshell service expose <sandbox> <port> [service]` sends:
  // the name may be empty, which is the sandbox's unnamed service, and domain
  // is always asked for. Gateways 0.1.0 to 0.1.2 route every endpoint for the
  // browser whatever the flag says, so there is nothing to choose.
  const handleExpose = () => {
    if (port === undefined) {
      return;
    }
    expose.mutate(
      { service: serviceName.trim(), targetPort: port, domain: true },
      { onSuccess: resetModal },
    );
  };

  if (services.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading services" />
      </Bullseye>
    );
  }

  // The services are re-read every few seconds. A refresh that fails leaves
  // them, and an open Expose service form, as they were, with a note above;
  // only a list that never loaded is replaced by the error.
  const refreshFailed = isRefreshError(services);
  if (services.isError && !refreshFailed) {
    return (
      <Alert
        variant="danger"
        title="Failed to load services"
        actionLinks={
          <Button variant="link" onClick={() => services.refetch()}>
            Retry
          </Button>
        }
      >
        {(services.error as Error).message}
      </Alert>
    );
  }

  const rows = services.data ?? [];

  return (
    <>
      {refreshFailed && (
        <RefreshErrorAlert
          title="The services could not be refreshed"
          error={services.error}
          onRetry={() => services.refetch()}
          className="pf-v6-u-mb-md"
          data-testid="services-refresh-error"
        />
      )}
      <Toolbar aria-label="Service actions">
        <ToolbarContent>
          <ToolbarItem>
            <Button
              onClick={() => setIsModalOpen(true)}
              data-testid="expose-service-button"
            >
              Expose service
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {(expose.isError || remove.isError) && (
        <Alert variant="danger" isInline title="Service operation failed">
          {((expose.error || remove.error) as Error).message}
        </Alert>
      )}
      <Table
        aria-label="Exposed services"
        variant="compact"
        data-testid="services-table"
      >
        <Thead>
          <Tr>
            <Th>Service</Th>
            <Th>Target port</Th>
            <Th>URL</Th>
            <Th>Domain</Th>
            <Th screenReaderText="Actions" />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((svc) => (
            <Tr key={svc.serviceName}>
              <Td dataLabel="Service">{serviceDisplayName(svc.serviceName)}</Td>
              <Td dataLabel="Target port">{svc.targetPort}</Td>
              <Td dataLabel="URL">
                {svc.url ? (
                  <a href={svc.url} target="_blank" rel="noopener noreferrer">
                    {svc.url} <ExternalLinkAltIcon />
                  </a>
                ) : (
                  '-'
                )}
              </Td>
              <Td dataLabel="Domain">
                {svc.domain ? <Label color="green">Enabled</Label> : '-'}
              </Td>
              <Td isActionCell>
                <ActionsColumn
                  items={[
                    {
                      title: 'Delete',
                      onClick: () => remove.mutate(svc.serviceName),
                      isDisabled: remove.isPending,
                    },
                  ]}
                />
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={5}>No services exposed on this sandbox</Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <Modal
        variant="small"
        isOpen={isModalOpen}
        onClose={resetModal}
        aria-label="Expose service"
      >
        <ModalHeader title="Expose service" />
        <ModalBody>
          <Form>
            <FormGroup label="Service name" fieldId="svc-name">
              <TextInput
                id="svc-name"
                data-testid="expose-service-name"
                value={serviceName}
                onChange={(_event, value) => setServiceName(value)}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    A lowercase DNS label of at most 19 characters. Leave it
                    empty for the sandbox&apos;s unnamed service, of which it
                    can have one.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Target port" isRequired fieldId="svc-port">
              <TextInput
                id="svc-port"
                data-testid="expose-service-port"
                type="number"
                value={targetPort}
                onChange={(_event, value) => setTargetPort(value)}
                isRequired
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    The port the service listens on inside the sandbox, on
                    127.0.0.1.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </Form>
          {expose.isError && (
            <Alert
              variant="danger"
              isInline
              title="Failed to expose service"
              className="pf-v6-u-mt-md"
            >
              {(expose.error as Error).message}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={handleExpose}
            isLoading={expose.isPending}
            isDisabled={expose.isPending || port === undefined}
            data-testid="expose-service-confirm"
          >
            Expose
          </Button>
          <Button
            variant="link"
            onClick={resetModal}
            isDisabled={expose.isPending}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default SandboxServicesTab;
