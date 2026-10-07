import React, { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  ExpandableSection,
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
  TextArea,
  TextInput,
} from '@patternfly/react-core';

import {
  ENDPOINT_PROTOCOLS,
  emptyEndpoint,
  generatedRuleName,
  isL7Protocol,
  supportsRequestBodyCredentialRewrite,
  supportsWebsocketCredentialRewrite,
} from './utils';
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
  const [isMoreOpen, setMoreOpen] = useState(false);

  const handleClose = () => {
    setAddForm({ ...emptyEndpoint });
    setAddRuleName('');
    setMoreOpen(false);
    onClose();
  };

  const l7 = isL7Protocol(addForm.protocol);
  // SQL is inspected but not parsed far enough to block on: the gateway
  // refuses enforce for it.
  const auditOnly = addForm.protocol === 'sql';

  const setProtocol = (protocol: string) =>
    setAddForm((f) => ({
      ...f,
      protocol,
      enforcement:
        protocol === 'sql' ? 'NETWORK_ENFORCEMENT_MODE_AUDIT' : f.enforcement,
    }));

  const host = addForm.host.trim();

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={handleClose}
      aria-label="Add endpoint"
    >
      <ModalHeader
        title="Add network endpoint"
        description="Adds an endpoint to the sandbox's network policy, the way `openshell policy update --add-endpoint host:port:access:protocol:enforcement:options` does. The gateway merges it into the current policy."
      />
      <ModalBody>
        <Form>
          <FormGroup label="Rule name" fieldId="rule-name">
            <TextInput
              id="rule-name"
              data-testid="rule-name-input"
              value={addRuleName}
              onChange={(_event, value) => setAddRuleName(value)}
              placeholder={
                host
                  ? generatedRuleName(host, addForm.port)
                  : 'allow_<host>_<port>'
              }
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  The network_policies map key. Leave empty for the name the CLI
                  generates from the host and port. Naming an existing rule adds
                  the endpoint to it, which the gateway refuses when that would
                  let the rule&apos;s binaries reach an endpoint, or a new
                  binary reach its endpoints, without the request saying so.
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
                  Hostname or glob: *.example.com matches one subdomain label,
                  **.example.com any depth. A bare * or ** is not accepted.
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
                const value = Number((event.target as HTMLInputElement).value);
                if (!isNaN(value)) setAddForm((f) => ({ ...f, port: value }));
              }}
            />
          </FormGroup>
          <FormGroup label="Protocol" fieldId="endpoint-protocol">
            <FormSelect
              id="endpoint-protocol"
              data-testid="endpoint-protocol-select"
              value={addForm.protocol}
              onChange={(_event, value) => setProtocol(value)}
            >
              {ENDPOINT_PROTOCOLS.map((protocol) => (
                <FormSelectOption
                  key={protocol.value}
                  value={protocol.value}
                  label={protocol.label}
                />
              ))}
            </FormSelect>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  GraphQL, JSON-RPC and MCP endpoints need explicit rules: add
                  them by editing the policy document.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Access" fieldId="endpoint-access">
            <FormSelect
              id="endpoint-access"
              data-testid="endpoint-access-select"
              value={l7 ? addForm.access : ''}
              isDisabled={!l7}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, access: value }))
              }
            >
              {!l7 && <FormSelectOption value="" label="Not inspected" />}
              <FormSelectOption
                value="NETWORK_ACCESS_PRESET_READ_ONLY"
                label="Read-only"
              />
              <FormSelectOption
                value="NETWORK_ACCESS_PRESET_READ_WRITE"
                label="Read-write"
              />
              <FormSelectOption
                value="NETWORK_ACCESS_PRESET_FULL"
                label="Full"
              />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Enforcement" fieldId="endpoint-enforcement">
            <FormSelect
              id="endpoint-enforcement"
              data-testid="endpoint-enforcement-select"
              value={l7 ? addForm.enforcement : ''}
              isDisabled={!l7}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, enforcement: value }))
              }
            >
              {!l7 && <FormSelectOption value="" label="Not inspected" />}
              <FormSelectOption
                value="NETWORK_ENFORCEMENT_MODE_ENFORCE"
                label="Enforce (block violations)"
                isDisabled={auditOnly}
              />
              <FormSelectOption
                value="NETWORK_ENFORCEMENT_MODE_AUDIT"
                label="Audit (log only)"
              />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Binaries" fieldId="endpoint-binary">
            <TextArea
              id="endpoint-binary"
              data-testid="endpoint-binary-input"
              value={addForm.binaryPaths}
              onChange={(_event, value) =>
                setAddForm((f) => ({ ...f, binaryPaths: value }))
              }
              placeholder="/usr/bin/git"
              rows={2}
              resizeOrientation="vertical"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  One path per line. Only these binaries may reach the endpoint;
                  leave empty to allow any process.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <ExpandableSection
            toggleText="More options"
            isExpanded={isMoreOpen}
            onToggle={(_event, expanded) => setMoreOpen(expanded)}
            data-testid="endpoint-more-options"
          >
            <FormGroup label="Allowed IPs" fieldId="endpoint-allowed-ips">
              <TextArea
                id="endpoint-allowed-ips"
                data-testid="endpoint-allowed-ips-input"
                value={addForm.allowedIps}
                onChange={(_event, value) =>
                  setAddForm((f) => ({ ...f, allowedIps: value }))
                }
                placeholder="10.0.5.0/24"
                rows={2}
                resizeOrientation="vertical"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    One IP or CIDR per line. The host must resolve into this
                    list, which replaces the block on internal addresses.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup fieldId="endpoint-credential-options" role="group">
              <Checkbox
                id="endpoint-websocket-rewrite"
                data-testid="endpoint-websocket-rewrite"
                label="Rewrite credential placeholders in WebSocket text messages"
                isChecked={
                  addForm.websocketCredentialRewrite &&
                  supportsWebsocketCredentialRewrite(addForm.protocol)
                }
                isDisabled={
                  !supportsWebsocketCredentialRewrite(addForm.protocol)
                }
                onChange={(_event, checked) =>
                  setAddForm((f) => ({
                    ...f,
                    websocketCredentialRewrite: checked,
                  }))
                }
                description="REST and WebSocket endpoints only."
              />
              <Checkbox
                id="endpoint-body-rewrite"
                data-testid="endpoint-body-rewrite"
                label="Rewrite credential placeholders in request bodies"
                isChecked={
                  addForm.requestBodyCredentialRewrite &&
                  supportsRequestBodyCredentialRewrite(addForm.protocol)
                }
                isDisabled={
                  !supportsRequestBodyCredentialRewrite(addForm.protocol)
                }
                onChange={(_event, checked) =>
                  setAddForm((f) => ({
                    ...f,
                    requestBodyCredentialRewrite: checked,
                  }))
                }
                description="REST endpoints only."
              />
              <Checkbox
                id="endpoint-uninspected-credentials"
                data-testid="endpoint-uninspected-credentials"
                label="Allow credentials on traffic OpenShell cannot inspect"
                isChecked={addForm.allowUninspectedCredentials}
                onChange={(_event, checked) =>
                  setAddForm((f) => ({
                    ...f,
                    allowUninspectedCredentials: checked,
                  }))
                }
                description="A security-sensitive escape hatch: credential-bearing requests go out without inspection or rewriting."
              />
            </FormGroup>
          </ExpandableSection>
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
          onClick={() => onSubmit(addRuleName, addForm)}
          isDisabled={!host || isPending}
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
