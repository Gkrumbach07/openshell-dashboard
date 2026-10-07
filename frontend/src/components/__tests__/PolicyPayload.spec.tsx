import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { parse as parseYaml } from 'yaml';

import PolicyPayload from '../policy/PolicyPayload';
import { downloadText } from '../../utils/download';
import { parsePolicyFile } from '../../utils/policyFile';
import type { SandboxPolicy } from '../../types';

jest.mock('../../utils/download', () => ({ downloadText: jest.fn() }));

const mockDownload = downloadText as jest.Mock;

const policy: SandboxPolicy = {
  version: 1,
  filesystem: { includeWorkdir: true, readOnly: ['/usr'], readWrite: ['/tmp'] },
  networkPolicies: {
    registry: {
      name: 'registry',
      endpoints: [
        {
          host: 'registry.example.com',
          port: 443,
          ports: [443, 5000],
          protocol: 'rest',
          enforcement: 'NETWORK_ENFORCEMENT_MODE_ENFORCE',
          rules: [{ allow: { method: 'GET', path: '/v2/**' } }],
        },
      ],
    },
  },
};

const renderPayload = (shown: SandboxPolicy = policy) =>
  render(
    <PolicyPayload
      policy={shown}
      fileName="policy-revision-3"
      data-testid="payload"
    />,
  );

const choose = (format: 'yaml' | 'json') =>
  fireEvent.click(
    within(screen.getByTestId(`payload-format-${format}`)).getByRole('button'),
  );

const text = () => screen.getByTestId('payload').textContent ?? '';

describe('PolicyPayload', () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the policy as the gateway's JSON until YAML is chosen", () => {
    renderPayload();
    expect(JSON.parse(text())).toEqual(policy);
    expect(screen.getByTestId('payload-format-note')).toHaveTextContent(
      "JSON is the policy as the gateway's API holds it",
    );
  });

  it('shows the policy as the policy file the CLI prints, and says so', () => {
    renderPayload();
    choose('yaml');
    expect(parseYaml(text())).toEqual({
      version: 1,
      filesystem_policy: {
        include_workdir: true,
        read_only: ['/usr'],
        read_write: ['/tmp'],
      },
      network_policies: {
        registry: {
          name: 'registry',
          endpoints: [
            {
              host: 'registry.example.com',
              ports: [443, 5000],
              protocol: 'rest',
              enforcement: 'enforce',
              rules: [{ allow: { method: 'GET', path: '/v2/**' } }],
            },
          ],
        },
      },
    });
    // The YAML on screen is a file that reads back to the policy it shows.
    expect(parsePolicyFile(text())).toEqual({ policy, diagnostics: [] });
    const note = screen.getByTestId('payload-format-note');
    expect(note).toHaveTextContent('openshell policy get --full');
    expect(note).toHaveTextContent('--policy');

    choose('json');
    expect(JSON.parse(text())).toEqual(policy);
  });

  it('saves what is shown, under a name with the extension of its format', () => {
    renderPayload();
    fireEvent.click(screen.getByTestId('payload-download'));
    expect(mockDownload).toHaveBeenLastCalledWith(
      'policy-revision-3.json',
      JSON.stringify(policy, null, 2),
      'application/json',
    );

    choose('yaml');
    fireEvent.click(screen.getByTestId('payload-download'));
    const [name, saved, type] = mockDownload.mock.calls[1];
    expect(name).toBe('policy-revision-3.yaml');
    expect(type).toBe('application/yaml');
    expect(saved).toBe(text());
    expect(parsePolicyFile(saved).policy).toEqual(policy);
  });

  it('says what the YAML of a policy leaves out when the gateway marked it', () => {
    renderPayload({
      version: 1,
      networkPolicies: {
        _provider_claude: {
          name: '_provider_claude',
          endpoints: [
            {
              host: 'api.anthropic.com',
              port: 443,
              providerCredentialed: true,
            },
          ],
        },
      },
    });
    expect(screen.getByTestId('payload-format-note')).not.toHaveTextContent(
      'providerCredentialed',
    );
    choose('yaml');
    expect(text()).not.toMatch(/provider_?credentialed/i);
    expect(screen.getByTestId('payload-format-note')).toHaveTextContent(
      'A policy file has no field for the marks the gateway puts on an endpoint (providerCredentialed, advisorProposed); those are in the JSON only.',
    );
  });

  it('says why a policy cannot be written as a policy file, and still shows its JSON', () => {
    const removed: SandboxPolicy = {
      version: 1,
      networkPolicies: {
        api: {
          name: 'api',
          endpoints: [{ host: 'a.example', tls: 'NETWORK_TLS_MODE_TERMINATE' }],
        },
      },
    };
    renderPayload(removed);
    choose('yaml');
    expect(screen.queryByTestId('payload')).not.toBeInTheDocument();
    expect(screen.getByTestId('payload-unwritable')).toHaveTextContent(
      "network policy 'api': endpoint 0: unknown tls value 'terminate'; omit the field to keep automatic TLS termination",
    );
    expect(screen.getByTestId('payload-download')).toBeDisabled();
    fireEvent.click(screen.getByTestId('payload-download'));
    expect(mockDownload).not.toHaveBeenCalled();

    choose('json');
    expect(JSON.parse(text())).toEqual(removed);
    expect(screen.getByTestId('payload-download')).toBeEnabled();
  });
});
