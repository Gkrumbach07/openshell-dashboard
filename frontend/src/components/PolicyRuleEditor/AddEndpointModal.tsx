import React, { useState } from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberInput,
  TextInput,
} from '@patternfly/react-core';

import { emptyEndpoint } from './utils';
import type { EndpointFormValues } from './utils';

type AddEndpointModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (ruleName: string, form: EndpointFormValues) => void;
  isPending: boolean;
  error?: string;
};

const AddEndpointModal: React.FC<AddEndpointModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
}) => {
  const [addForm, setAddForm] = useState<EndpointFormValues>({
    ...emptyEndpoint,
  });
  const [addRuleName, setAddRuleName] = useState('');

  const handleClose = () => {
    setAddForm({ ...emptyEndpoint });
    setAddRuleName('');
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(addRuleName, addForm);
    setAddForm({ ...emptyEndpoint });
    setAddRuleName('');
  };

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={handleClose}
      aria-label="Add endpoint"
    >
      <ModalHeader
        title="Add network endpoint"
        description="Adds an endpoint to the sandbox's network policy. Maps to `policy update --add-endpoint host:port:access:protocol:enforcement`."
      />
      <ModalBody>
        <Form>
          <FormGroup label="Rule name" fieldId="rule-name">
            <TextInput
              id="rule-name"
              data-testid="rule-name-input"
              value={addRuleName}
              onChange={(_event, value) => setAddRuleName(value)}
              placeholder="Auto-generated from host if empty"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  The network_policies map key. Leave empty to derive from the
                  hostname.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Host" isRequired fieldId="endpoint-host">
            <TextInput
              id="endpoint-host"
              data-testid="endpoint-host-input"
              isRequired
              value={addForm.host}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, host: value }))
              }
              placeholder="api.anthropic.com"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Hostname or glob pattern. Use ** for any host.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Port" isRequired fieldId="endpoint-port">
            <NumberInput
              id="endpoint-port"
              data-testid="endpoint-port-input"
              value={addForm.port}
              min={1}
              max={65535}
              onMinus={() =>
                setAddForm((f) => ({ ...f, port: Math.max(1, f.port - 1) }))
              }
              onPlus={() =>
                setAddForm((f) => ({
                  ...f,
                  port: Math.min(65535, f.port + 1),
                }))
              }
              onChange={(event) => {
                const value = Number(
                  (event.target as HTMLInputElement).value,
                );
                if (!isNaN(value)) setAddForm((f) => ({ ...f, port: value }));
              }}
            />
          </FormGroup>
          <FormGroup label="Access" fieldId="endpoint-access">
            <FormSelect
              id="endpoint-access"
              data-testid="endpoint-access-select"
              value={addForm.access}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, access: value }))
              }
            >
              <FormSelectOption value="read-only" label="Read-only" />
              <FormSelectOption value="read-write" label="Read-write" />
              <FormSelectOption value="full" label="Full" />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Protocol" fieldId="endpoint-protocol">
            <FormSelect
              id="endpoint-protocol"
              data-testid="endpoint-protocol-select"
              value={addForm.protocol}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, protocol: value }))
              }
            >
              <FormSelectOption value="rest" label="REST" />
              <FormSelectOption value="websocket" label="WebSocket" />
              <FormSelectOption value="graphql" label="GraphQL" />
              <FormSelectOption value="mcp" label="MCP" />
              <FormSelectOption value="" label="L4 only (no L7 inspection)" />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Enforcement" fieldId="endpoint-enforcement">
            <FormSelect
              id="endpoint-enforcement"
              data-testid="endpoint-enforcement-select"
              value={addForm.enforcement}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, enforcement: value }))
              }
            >
              <FormSelectOption
                value="enforce"
                label="Enforce (block violations)"
              />
              <FormSelectOption value="audit" label="Audit (log only)" />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Binary path" fieldId="endpoint-binary">
            <TextInput
              id="endpoint-binary"
              data-testid="endpoint-binary-input"
              value={addForm.binaryPath}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, binaryPath: value }))
              }
              placeholder="/usr/bin/git (optional)"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Restrict this endpoint to a specific binary. Leave empty to
                  allow any process.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
        </Form>
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Failed to add endpoint"
            className="pf-v6-u-mt-md"
          >
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSubmit}
          isDisabled={!addForm.host || isPending}
          isLoading={isPending}
          data-testid="submit-add-endpoint"
        >
          Add endpoint
        </Button>
        <Button variant="link" onClick={handleClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddEndpointModal;
