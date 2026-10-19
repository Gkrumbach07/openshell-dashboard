import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { DescriptionList, Stack } from '@patternfly/react-core';
import SandboxSpecDetails from '../sandbox/SandboxSpecDetails';
import SandboxStatusCards from '../sandbox/SandboxStatusCards';
import type { Sandbox } from '../../types';

// A sandbox as the gateway reports one that sets nothing optional.
const plain: Sandbox = {
  metadata: { id: 'sb-1', name: 'agent-1', createdAtMs: 0, resourceVersion: 1 },
  spec: { image: 'base', tty: true },
  status: { phase: 'READY', currentPolicyVersion: 1 },
};

// One with every optional field of the response set.
const full: Sandbox = {
  metadata: {
    id: 'sb-2',
    name: 'agent-2',
    createdAtMs: 0,
    resourceVersion: 4,
    annotations: { owner: 'ml-team' },
  },
  createdFromWorkloadTemplate: { name: 'claude-harness', resourceVersion: '7' },
  spec: {
    image: 'base',
    logLevel: 'debug',
    environment: { MODE: 'test' },
    command: ['sh', '-c', 'exec sleep infinity'],
    tty: false,
    gpu: true,
    gpuCount: 2,
    template: {
      runtimeClassName: 'kata',
      userNamespaces: true,
      labels: { pool: 'gpu' },
      annotations: { note: 'inline' },
      environment: { FROM: 'template' },
      resources: {
        limits: { cpu: '500m', memory: '512Mi' },
        requests: { cpu: '250m' },
      },
      driverConfig: { kubernetes: { pod: { priority: 'high' } } },
    },
  },
  status: {
    phase: 'ERROR',
    currentPolicyVersion: 3,
    configurationAdmission: {
      state: 'REJECTED',
      policyVersion: 3,
      policyHash: 'sha256:abc',
      configRevision: '18446744073709551615',
      providerEnvRevision: '9007199254740993',
      error: 'policy generation rejected',
    },
    endpointStatuses: [
      {
        endpointId: 'ep-1',
        host: 'mcp.example.test',
        ports: [443, 8443],
        path: '/**',
        lastResult: 'POLICY_DENIED',
        lastReportedAt: '2026-10-06T10:01:00Z',
      },
      {
        endpointId: 'ep-2',
        host: 'tools.example.test',
        ports: [443],
        lastResult: 'NO_OBSERVED_EXCHANGE',
      },
      {
        endpointId: 'ep-3',
        host: 'github.example.test',
        ports: [443],
        path: '/mcp',
        lastResult: 'CREDENTIAL_UNAVAILABLE',
        lastReportedAt: '2026-10-06T10:02:00Z',
        lastFailure: {
          domain: 'TOKEN_GRANT',
          code: 'provider_authorization_required',
          recoveryAction: 'REAUTHORIZE',
          provider: 'github',
          credentialKey: 'GITHUB_TOKEN',
          stage: 'token_service',
          upstreamHttpStatus: 401,
          requestId: '6f1c2a3e-0000-4000-8000-000000000001',
        },
      },
    ],
    lastTokenGrantFailure: {
      destinationHost: 'api.example.test',
      destinationPort: 8443,
      failure: {
        domain: 'TOKEN_GRANT',
        code: 'credential_selection_failed',
        recoveryAction: 'FIX_CONFIGURATION',
        stage: 'gateway_rpc',
        requestId: '6f1c2a3e-0000-4000-8000-000000000002',
      },
    },
  },
};

const renderSpec = (sandbox: Sandbox) =>
  render(
    <DescriptionList>
      <SandboxSpecDetails sandbox={sandbox} />
    </DescriptionList>,
  );

const renderStatus = (sandbox: Sandbox) =>
  render(
    <Stack>
      <SandboxStatusCards sandbox={sandbox} />
    </Stack>,
  );

describe('SandboxSpecDetails', () => {
  it('shows the CPU, memory and GPU a sandbox was created with', () => {
    renderSpec(full);
    expect(screen.getByTestId('sandbox-cpu-limit')).toHaveTextContent('500m');
    expect(screen.getByTestId('sandbox-memory-limit')).toHaveTextContent(
      '512Mi',
    );
    expect(screen.getByTestId('sandbox-cpu-request')).toHaveTextContent('250m');
    expect(screen.getByTestId('sandbox-gpu')).toHaveTextContent('2');
  });

  it('shows what the sandbox runs, with arguments that hold spaces kept apart', () => {
    renderSpec(full);
    expect(screen.getByTestId('sandbox-command')).toHaveTextContent(
      'sh -c "exec sleep infinity"',
    );
    expect(screen.getByTestId('sandbox-tty')).toHaveTextContent('No');
  });

  it('names the workload template and the revision the sandbox came from', () => {
    renderSpec(full);
    expect(screen.getByTestId('sandbox-workload-template')).toHaveTextContent(
      'claude-harness (revision 7)',
    );
  });

  it('shows the environment, the annotations and the rest of the template', () => {
    renderSpec(full);
    expect(screen.getByTestId('sandbox-environment')).toHaveTextContent(
      'MODE=test',
    );
    expect(screen.getByTestId('sandbox-annotations')).toHaveTextContent(
      'owner=ml-team',
    );
    expect(screen.getByTestId('sandbox-log-level')).toHaveTextContent('debug');
    expect(screen.getByTestId('sandbox-runtime-class')).toHaveTextContent(
      'kata',
    );
    expect(screen.getByTestId('sandbox-user-namespaces')).toHaveTextContent(
      'Enabled',
    );
    expect(
      screen.getByTestId('sandbox-template-environment'),
    ).toHaveTextContent('FROM=template');
    expect(screen.getByTestId('sandbox-template-labels')).toHaveTextContent(
      'pool=gpu',
    );
    expect(
      screen.getByTestId('sandbox-template-annotations'),
    ).toHaveTextContent('note=inline');
    expect(screen.getByTestId('sandbox-driver-config')).toHaveTextContent(
      '"priority": "high"',
    );
  });

  it('says what a sandbox without options runs, and that it has no limits', () => {
    renderSpec(plain);
    expect(screen.getByTestId('sandbox-command')).toHaveTextContent(
      'Login shell of the image',
    );
    expect(screen.getByTestId('sandbox-tty')).toHaveTextContent('Yes');
    expect(screen.getByTestId('sandbox-cpu-limit')).toHaveTextContent('-');
    expect(screen.getByTestId('sandbox-memory-limit')).toHaveTextContent('-');
    expect(screen.getByTestId('sandbox-gpu')).toHaveTextContent('-');
    for (const absent of [
      'sandbox-workload-template',
      'sandbox-cpu-request',
      'sandbox-memory-request',
      'sandbox-log-level',
      'sandbox-runtime-class',
      'sandbox-user-namespaces',
      'sandbox-template-environment',
      'sandbox-template-labels',
      'sandbox-template-annotations',
      'sandbox-driver-config',
    ]) {
      expect(screen.queryByTestId(absent)).not.toBeInTheDocument();
    }
  });

  it('shows the annotations the sandbox was given, not the bookkeeping of the gateway', () => {
    renderSpec({
      ...plain,
      metadata: {
        ...plain.metadata,
        annotations: {
          owner: 'ml-team',
          'internal.openshell.ai/auth-epoch': '1',
          'internal.openshell.ai/gateway-token-id': '7e5356c-75e9',
        },
      },
    });
    const annotations = screen.getByTestId('sandbox-annotations');
    expect(annotations).toHaveTextContent('owner=ml-team');
    expect(annotations).not.toHaveTextContent('internal.openshell.ai');
  });

  it('shows a GPU request without a count as the choice of the driver', () => {
    renderSpec({ ...plain, spec: { ...plain.spec, gpu: true } });
    expect(screen.getByTestId('sandbox-gpu')).toHaveTextContent(
      'Driver default',
    );
  });

  it('shows user namespaces that were turned off as such, not as unset', () => {
    renderSpec({
      ...plain,
      spec: { ...plain.spec, template: { userNamespaces: false } },
    });
    expect(screen.getByTestId('sandbox-user-namespaces')).toHaveTextContent(
      'Disabled',
    );
  });
});

describe('SandboxStatusCards', () => {
  it('renders nothing for a sandbox that reports neither', () => {
    renderStatus(plain);
    expect(
      screen.queryByTestId('sandbox-admission-card'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sandbox-endpoints-card'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sandbox-token-grant-failure-card'),
    ).not.toBeInTheDocument();
  });

  it('shows a rejected configuration with the reason and the revision', () => {
    renderStatus(full);
    expect(screen.getByTestId('sandbox-admission-state')).toHaveTextContent(
      'Rejected',
    );
    expect(screen.getByTestId('sandbox-admission-error')).toHaveTextContent(
      'policy generation rejected',
    );
    // A 64-bit fingerprint, shown digit for digit.
    expect(
      screen.getByTestId('sandbox-admission-config-revision'),
    ).toHaveTextContent('18446744073709551615');
    expect(screen.getByText('9007199254740993')).toBeInTheDocument();
    expect(screen.getByText('sha256:abc')).toBeInTheDocument();
  });

  it.each([
    ['ACCEPTED', 'Accepted'],
    ['PENDING', 'Pending'],
    ['UNSPECIFIED', 'Not reported'],
  ] as const)('shows admission state %s as %s', (state, text) => {
    renderStatus({
      ...plain,
      status: {
        ...plain.status,
        configurationAdmission: {
          state,
          policyVersion: 0,
          configRevision: '0',
          providerEnvRevision: '0',
        },
      },
    });
    expect(screen.getByTestId('sandbox-admission-state')).toHaveTextContent(
      text,
    );
    expect(
      screen.queryByTestId('sandbox-admission-error'),
    ).not.toBeInTheDocument();
  });

  it('lists each tool server with its last result, and says what a result is', () => {
    renderStatus(full);
    const card = within(screen.getByTestId('sandbox-endpoints-card'));
    const denied = within(card.getByText('mcp.example.test').closest('tr')!);
    expect(denied.getByText('443, 8443')).toBeInTheDocument();
    expect(denied.getByText('/**')).toBeInTheDocument();
    expect(
      denied.getByText('Blocked by OpenShell policy.'),
    ).toBeInTheDocument();
    expect(denied.getByText('2026-10-06T10:01:00Z')).toBeInTheDocument();

    const quiet = within(card.getByText('tools.example.test').closest('tr')!);
    expect(quiet.getByText('No exchange observed.')).toBeInTheDocument();
    expect(quiet.getByText('No report yet')).toBeInTheDocument();

    expect(
      card.getByText(/They do not check current availability/),
    ).toBeInTheDocument();
  });
  it('gives the cause of a failed result in its row, and none for the others', () => {
    renderStatus(full);
    const failure = within(screen.getByTestId('sandbox-endpoint-failure-ep-3'));
    const row = within(screen.getByText('github.example.test').closest('tr')!);
    expect(
      row.getByText('Required OpenShell-managed credential was unavailable.'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('sandbox-endpoint-failure-ep-3-cause'),
    ).toHaveTextContent('provider_authorization_required (token grant)');
    expect(failure.getByText('token_service')).toBeInTheDocument();
    expect(failure.getByText('401')).toBeInTheDocument();
    expect(
      screen.getByTestId('sandbox-endpoint-failure-ep-3-credential'),
    ).toHaveTextContent('github/GITHUB_TOKEN');
    expect(
      screen.getByTestId('sandbox-endpoint-failure-ep-3-recovery'),
    ).toHaveTextContent('Reauthorize the provider credential.');
    expect(
      failure.getByText('6f1c2a3e-0000-4000-8000-000000000001'),
    ).toBeInTheDocument();

    expect(
      screen.queryByTestId('sandbox-endpoint-failure-ep-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sandbox-endpoint-failure-ep-2'),
    ).not.toBeInTheDocument();
  });

  it('shows the last refused token grant with its destination and cause', () => {
    renderStatus(full);
    const card = within(screen.getByTestId('sandbox-token-grant-failure-card'));
    expect(card.getByText('Last token grant failure')).toBeInTheDocument();
    expect(
      screen.getByTestId('sandbox-token-grant-destination'),
    ).toHaveTextContent('api.example.test (port 8443)');
    expect(
      screen.getByTestId('sandbox-token-grant-failure-cause'),
    ).toHaveTextContent('credential_selection_failed (token grant)');
    expect(
      screen.getByTestId('sandbox-token-grant-failure-recovery'),
    ).toHaveTextContent(
      'An operator must fix the provider or identity configuration.',
    );
    // The grant failed before a credential was selected.
    expect(
      screen.queryByTestId('sandbox-token-grant-failure-credential'),
    ).not.toBeInTheDocument();
    expect(card.queryByText('Upstream HTTP status')).not.toBeInTheDocument();
    expect(
      card.getByText(/not the destination's current health/),
    ).toBeInTheDocument();
  });

  it.each([
    [undefined, 'UNSPECIFIED', 'No recovery action provided.', 'unknown'],
    [
      'SOMETHING_NEW',
      'SOME_NEW_DOMAIN',
      'The gateway reports the recovery action SOMETHING_NEW.',
      'SOME_NEW_DOMAIN',
    ],
  ])(
    'names recovery action %s and domain %s even without words for them',
    (recoveryAction, domain, recovery, domainText) => {
      renderStatus({
        ...plain,
        status: {
          ...plain.status,
          lastTokenGrantFailure: {
            destinationHost: 'api.example.test',
            destinationPort: 443,
            failure: { domain, code: 'some_code', recoveryAction },
          },
        },
      });
      expect(
        screen.getByTestId('sandbox-token-grant-failure-cause'),
      ).toHaveTextContent(`some_code (${domainText})`);
      expect(
        screen.getByTestId('sandbox-token-grant-failure-recovery'),
      ).toHaveTextContent(recovery);
    },
  );
});
