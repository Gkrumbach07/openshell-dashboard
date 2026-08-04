import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  Form,
  FormGroup,
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

type SandboxServicesTabProps = {
  workspace: string;
  sandboxName: string;
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
  const [domain, setDomain] = useState(false);

  const resetModal = () => {
    setServiceName('');
    setTargetPort('');
    setDomain(false);
    setIsModalOpen(false);
  };

  const handleExpose = () => {
    const port = parseInt(targetPort, 10);
    if (!serviceName || !port) {
      return;
    }
    expose.mutate(
      { service: serviceName, targetPort: port, domain },
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

  if (services.isError) {
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
              <Td dataLabel="Service">{svc.serviceName}</Td>
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
            <FormGroup label="Service name" isRequired fieldId="svc-name">
              <TextInput
                id="svc-name"
                data-testid="expose-service-name"
                value={serviceName}
                onChange={(_event, value) => setServiceName(value)}
                isRequired
              />
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
            </FormGroup>
            <FormGroup fieldId="svc-domain">
              <Checkbox
                id="svc-domain"
                data-testid="expose-service-domain"
                label="Enable browser-facing domain routing"
                isChecked={domain}
                onChange={(_event, checked) => setDomain(checked)}
              />
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
            isDisabled={expose.isPending || !serviceName || !targetPort}
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
