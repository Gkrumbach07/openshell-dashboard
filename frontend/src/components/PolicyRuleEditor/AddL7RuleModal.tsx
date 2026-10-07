import React, { useState } from 'react';
import {
  Alert,
  Button,
  Content,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  TextInput,
} from '@patternfly/react-core';

import { endpointSummary, hasAllowBase, isValidL7Path } from './utils';
import type { L7RuleKind } from './utils';
import type { NetworkEndpoint, NetworkPolicyRule } from '../../types';

type AddL7RuleModalProps = {
  ruleName: string;
  rule: NetworkPolicyRule;
  endpoint: NetworkEndpoint;
  onClose: () => void;
  onSubmit: (kind: L7RuleKind, method: string, path: string) => void;
  isPending: boolean;
  error?: string;
};

// Appends one allow or deny rule to an endpoint
// (`openshell policy update --add-allow|--add-deny`). The request names the
// endpoint's whole scope, which is shown here so the reviewer sees what the
// rule will apply to.
const AddL7RuleModal: React.FC<AddL7RuleModalProps> = ({
  ruleName,
  rule,
  endpoint,
  onClose,
  onSubmit,
  isPending,
  error,
}) => {
  const [kind, setKind] = useState<L7RuleKind>('allow');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');

  const canDeny = hasAllowBase(endpoint);
  const pathInvalid = path.trim() !== '' && !isValidL7Path(path);
  const methodInvalid = /\s/.test(method.trim());
  const binaries = (rule.binaries ?? []).map((binary) => binary.path);

  return (
    <Modal
      variant="medium"
      isOpen
      onClose={onClose}
      aria-label="Add request rule"
      data-testid="add-l7-rule-modal"
    >
      <ModalHeader
        title={`Add a request rule to ${ruleName}`}
        description="Appends an allow or deny rule for requests to this endpoint, the way `openshell policy update --add-allow` and `--add-deny` do."
      />
      <ModalBody>
        <Content component="p">
          Applies to <strong>{endpointSummary(endpoint)}</strong>, for{' '}
          {binaries.length > 0 ? binaries.join(', ') : 'any binary'}.
        </Content>
        {endpoint.access && (
          <Alert
            variant="info"
            isInline
            title="The access preset becomes explicit rules"
            className="pf-v6-u-mb-md"
          >
            An endpoint has either an access preset or explicit rules. Adding an
            allow rule replaces this endpoint&apos;s preset with the allow rules
            it stands for, plus the new one.
          </Alert>
        )}
        <Form>
          <FormGroup role="radiogroup" label="Rule" fieldId="l7-kind" isInline>
            <Radio
              id="l7-kind-allow"
              name="l7-kind"
              label="Allow"
              isChecked={kind === 'allow'}
              onChange={() => setKind('allow')}
              data-testid="l7-kind-allow"
            />
            <Radio
              id="l7-kind-deny"
              name="l7-kind"
              label="Deny"
              isChecked={kind === 'deny'}
              isDisabled={!canDeny}
              onChange={() => setKind('deny')}
              data-testid="l7-kind-deny"
            />
            {!canDeny && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    A deny rule narrows what is allowed, and this endpoint
                    allows nothing yet.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
          <FormGroup label="Method" isRequired fieldId="l7-method">
            <TextInput
              id="l7-method"
              data-testid="l7-method-input"
              isRequired
              value={method}
              validated={methodInvalid ? 'error' : 'default'}
              onChange={(_event, value) => setMethod(value)}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  An HTTP method such as GET or POST, or WEBSOCKET_TEXT on a
                  WebSocket endpoint. Sent in upper case.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Path" isRequired fieldId="l7-path">
            <TextInput
              id="l7-path"
              data-testid="l7-path-input"
              isRequired
              value={path}
              validated={pathInvalid ? 'error' : 'default'}
              onChange={(_event, value) => setPath(value)}
              placeholder="/v1/messages/**"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={pathInvalid ? 'error' : 'default'}>
                  A path glob that starts with /, or ** for every path.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
        </Form>
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Failed to add the rule"
            className="pf-v6-u-mt-md"
          >
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={() => onSubmit(kind, method, path)}
          isDisabled={
            isPending ||
            !method.trim() ||
            methodInvalid ||
            !path.trim() ||
            pathInvalid
          }
          isLoading={isPending}
          data-testid="submit-add-l7-rule"
        >
          Add rule
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddL7RuleModal;
