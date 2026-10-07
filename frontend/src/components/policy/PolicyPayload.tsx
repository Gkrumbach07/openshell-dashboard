import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockAction,
  CodeBlockCode,
  Content,
  List,
  ListItem,
} from '@patternfly/react-core';
import { DownloadIcon } from '@patternfly/react-icons';

import { downloadText } from '../../utils/download';
import { hasGatewayMarks, policyToText } from '../../utils/policyFile';
import type { PolicyFileFormat } from '../../utils/policyFile';
import type { SandboxPolicy } from '../../types';
import PolicyFormatToggle, { POLICY_FORMAT_NOTE } from './PolicyFormatToggle';

type PolicyPayloadProps = {
  policy: SandboxPolicy;
  // The name a download is saved under, without its extension.
  fileName: string;
  // The id of the text itself. The controls beside it are `<id>-format-yaml`,
  // `<id>-format-json` and `<id>-download`.
  'data-testid': string;
};

const MIME: Record<PolicyFileFormat, string> = {
  yaml: 'application/yaml',
  json: 'application/json',
};

// A policy to read: as JSON, the way the gateway holds it, or as the YAML
// policy file the CLI prints for it, and either one to save as a file.
const PolicyPayload: React.FC<PolicyPayloadProps> = ({
  policy,
  fileName,
  'data-testid': testId,
}) => {
  const [format, setFormat] = useState<PolicyFileFormat>('json');
  const shown = useMemo(() => policyToText(policy, format), [policy, format]);

  return (
    <>
      <CodeBlock
        actions={
          <>
            <CodeBlockAction>
              <PolicyFormatToggle
                format={format}
                onChange={setFormat}
                data-testid={`${testId}-format`}
              />
            </CodeBlockAction>
            <CodeBlockAction>
              <Button
                variant="plain"
                aria-label={`Download as ${format.toUpperCase()}`}
                icon={<DownloadIcon />}
                isDisabled={shown.text === undefined}
                onClick={() => {
                  if (shown.text !== undefined) {
                    downloadText(
                      `${fileName}.${format}`,
                      shown.text,
                      MIME[format],
                    );
                  }
                }}
                data-testid={`${testId}-download`}
              />
            </CodeBlockAction>
          </>
        }
      >
        {shown.text !== undefined ? (
          <CodeBlockCode data-testid={testId}>{shown.text}</CodeBlockCode>
        ) : (
          <Alert
            variant="warning"
            isInline
            isPlain
            title="This policy cannot be written as a policy file"
            data-testid={`${testId}-unwritable`}
          >
            <List isPlain>
              {shown.diagnostics.map((diagnostic) => (
                <ListItem key={`${diagnostic.path}:${diagnostic.message}`}>
                  {diagnostic.message}
                </ListItem>
              ))}
            </List>
          </Alert>
        )}
      </CodeBlock>
      <Content component="small" data-testid={`${testId}-format-note`}>
        {POLICY_FORMAT_NOTE[format]}
        {format === 'yaml' &&
          hasGatewayMarks(policy) &&
          ' A policy file has no field for the marks the gateway puts on an endpoint (providerCredentialed, advisorProposed); those are in the JSON only.'}
      </Content>
    </>
  );
};

export default PolicyPayload;
