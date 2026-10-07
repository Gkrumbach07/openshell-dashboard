import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import PolicyDocumentInput from '../policy/PolicyDocumentInput';
import { usePolicyText } from '../../hooks/usePolicyText';
import type { SandboxPolicy } from '../../types';

// Monaco does not run under jsdom. Two textareas stand in for the editor.
// The first is typing, which the editor reports through onChange and through
// onCodeChange. The second is a file being loaded, which it reports through
// onCodeChange alone: the editor's onChange "does not fire when a file is
// uploaded", in the words of its own documentation.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    language,
    isUploadEnabled,
    onChange,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    language?: string;
    isUploadEnabled?: boolean;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <>
      <textarea
        data-testid={testId}
        data-language={language}
        value={code}
        onChange={(event) => {
          onChange?.(event.target.value);
          onCodeChange?.(event.target.value);
        }}
      />
      {isUploadEnabled && (
        <textarea
          data-testid={`${testId}-upload`}
          value=""
          onChange={(event) => onCodeChange?.(event.target.value)}
        />
      )}
    </>
  ),
}));

const POLICY: SandboxPolicy = {
  version: 1,
  networkPolicies: {
    web: {
      name: 'web',
      endpoints: [
        {
          host: 'a.example',
          port: 443,
          ports: [443],
          protocol: 'rest',
          access: 'NETWORK_ACCESS_PRESET_READ_ONLY',
        },
      ],
    },
  },
};

const YAML = `version: 1
network_policies:
  web:
    endpoints:
      - host: a.example
        port: 443
        protocol: rest
        access: read-only
`;

// The editor with the state a page keeps around it: the text, and what
// reading it gives, which is what the page would send.
const Harness: React.FC<{ initial: string }> = ({ initial }) => {
  const [text, setText] = useState(initial);
  const reading = usePolicyText(text);
  return (
    <>
      <PolicyDocumentInput
        text={text}
        onChange={setText}
        reading={reading}
        height="10rem"
        data-testid="input"
      />
      <output data-testid="policy">{JSON.stringify(reading.parsed)}</output>
    </>
  );
};

const editor = () => screen.getByTestId('input') as HTMLTextAreaElement;

const type = (value: string) =>
  fireEvent.change(editor(), { target: { value } });

const load = (value: string) =>
  fireEvent.change(screen.getByTestId('input-upload'), { target: { value } });

const choice = (format: 'yaml' | 'json') =>
  within(screen.getByTestId(`input-format-${format}`)).getByRole('button');

const selected = () =>
  (['yaml', 'json'] as const).filter(
    (format) => choice(format).getAttribute('aria-pressed') === 'true',
  );

const policy = () =>
  JSON.parse(screen.getByTestId('policy').textContent ?? 'null');

describe('PolicyDocumentInput', () => {
  it('takes the format of a document from the document', () => {
    render(<Harness initial={JSON.stringify(POLICY, null, 2)} />);
    expect(selected()).toEqual(['json']);
    expect(editor()).toHaveAttribute('data-language', 'json');
    expect(screen.getByTestId('input-format-note')).toHaveTextContent(
      "JSON is the policy as the gateway's API holds it",
    );

    type(YAML);
    expect(selected()).toEqual(['yaml']);
    expect(editor()).toHaveAttribute('data-language', 'yaml');
    expect(screen.getByTestId('input-format-note')).toHaveTextContent(
      'YAML is the policy file format: what `openshell policy get --full` prints',
    );
    expect(policy()).toEqual(POLICY);
  });

  // The regression this component exists to prevent: a file that is loaded
  // was shown in the editor and never reached the document that was sent.
  it('makes a file that is loaded the document, whatever was there', () => {
    render(<Harness initial={JSON.stringify({ version: 1 }, null, 2)} />);
    expect(policy()).toEqual({ version: 1 });

    load(YAML);
    expect(editor().value).toBe(YAML);
    expect(selected()).toEqual(['yaml']);
    expect(policy()).toEqual(POLICY);
  });

  it('rewrites the document in the other format when that is chosen', () => {
    render(<Harness initial={YAML} />);
    fireEvent.click(choice('json'));
    expect(selected()).toEqual(['json']);
    expect(JSON.parse(editor().value)).toEqual(POLICY);
    expect(policy()).toEqual(POLICY);

    fireEvent.click(choice('yaml'));
    expect(selected()).toEqual(['yaml']);
    // Written the way the CLI writes it, name and all.
    expect(editor().value).toBe(
      'version: 1\nnetwork_policies:\n  web:\n    name: web\n    endpoints:\n      - host: a.example\n        port: 443\n        protocol: rest\n        access: read-only\n',
    );
    expect(policy()).toEqual(POLICY);
  });

  it('does not offer the other format for a document it cannot read', () => {
    render(<Harness initial={YAML} />);
    type(`${YAML}  bogus: [\n`);
    expect(policy()).toBeNull();
    expect(choice('json')).toBeDisabled();
    expect(choice('yaml')).toBeEnabled();
    // Nothing is rewritten by a choice that is not offered.
    fireEvent.click(choice('json'));
    expect(editor().value).toBe(`${YAML}  bogus: [\n`);
  });

  it('says why a JSON document cannot be shown as a policy file', () => {
    const removed = {
      version: 1,
      networkPolicies: {
        api: {
          endpoints: [
            { host: 'a.example', tls: 'NETWORK_TLS_MODE_PASSTHROUGH' },
          ],
        },
      },
    };
    render(<Harness initial={JSON.stringify(removed)} />);
    // It is still a document the gateway can be sent, and judge.
    expect(policy()).toEqual(removed);
    expect(choice('yaml')).toBeDisabled();
    expect(screen.getByTestId('input-format-blocked')).toHaveTextContent(
      "This document cannot be shown as YAML: network policy 'api': endpoint 0: unknown tls value 'passthrough'; omit the field to keep automatic TLS termination",
    );
  });

  it('keeps the format that was chosen for a document that is still empty', () => {
    render(<Harness initial="" />);
    expect(selected()).toEqual(['yaml']);
    fireEvent.click(choice('json'));
    expect(selected()).toEqual(['json']);
    expect(editor().value).toBe('');
    expect(editor()).toHaveAttribute('data-language', 'json');
  });
});
