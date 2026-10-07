import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateSandboxModal from '../CreateSandboxModal';
import type { CreateSandboxRequest } from '../../types';

// These tests drive the real form state (useCreateSandboxForm) through the
// modal, so what they assert is the request the gateway is sent.

const mockMutate = jest.fn();
const mockAddSuccess = jest.fn();
let mockFlags = { settings: true };
let mockRole = { isWorkspaceAdmin: true };

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
    mutate: mockMutate,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => mockFlags),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => mockRole),
}));

// The approval mode is written through the real settings client, down to the
// HTTP helper.
jest.mock('../../api/client', () => ({
  get: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: mockAddSuccess,
    addDanger: jest.fn(),
  })),
}));

import { put } from '../../api/client';
const mockPut = put as jest.Mock;

const onClose = jest.fn();

const renderModal = () =>
  render(<CreateSandboxModal workspace="team-a" isOpen onClose={onClose} />);

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

// The request the form sent on its one and only submit.
const sentRequest = (): CreateSandboxRequest => {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  return mockMutate.mock.calls[0][0] as CreateSandboxRequest;
};

const submit = () =>
  fireEvent.click(screen.getByTestId('create-sandbox-submit'));

describe('CreateSandboxModal options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags = { settings: true };
    mockRole = { isWorkspaceAdmin: true };
  });

  it('sends none of the options when they are left alone', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    submit();

    const request = sentRequest();
    expect(request.image).toBe(
      'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
    );
    for (const option of [
      'environment',
      'annotations',
      'logLevel',
      'command',
      'tty',
      'runtimeClassName',
      'driverConfig',
      'serviceExposures',
    ] as const) {
      expect(request[option]).toBeUndefined();
    }
  });

  it('sends environment variables, annotations and the log level', () => {
    renderModal();
    type('sandbox-image-input', 'base');

    fireEvent.click(screen.getByTestId('sandbox-env-add'));
    type('sandbox-env-key-0', 'MODE');
    type('sandbox-env-value-0', 'test');
    fireEvent.click(screen.getByTestId('sandbox-env-add'));
    type('sandbox-env-key-1', 'EMPTY');

    fireEvent.click(screen.getByTestId('sandbox-annotation-add'));
    type('sandbox-annotation-key-0', 'owner');
    type('sandbox-annotation-value-0', 'ml-team');

    type('sandbox-log-level-select', 'debug');
    submit();

    const request = sentRequest();
    expect(request.environment).toEqual({ MODE: 'test', EMPTY: '' });
    expect(request.annotations).toEqual({ owner: 'ml-team' });
    expect(request.logLevel).toBe('debug');
  });

  it('refuses an environment value without a name, and says so', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    fireEvent.click(screen.getByTestId('sandbox-env-add'));
    type('sandbox-env-value-0', 'orphan');

    expect(screen.getByTestId('sandbox-env-help')).toHaveTextContent(
      'Every value needs a name',
    );
    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
  });

  it('sends the command as an argv, one argument per line, with its terminal', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    type('sandbox-command-input', 'sh\n-c\nexec sleep infinity');
    fireEvent.click(screen.getByTestId('sandbox-tty'));
    submit();

    const request = sentRequest();
    expect(request.command).toEqual(['sh', '-c', 'exec sleep infinity']);
    expect(request.tty).toBe(true);
  });

  it('offers the terminal only beside a command, and sends none without one', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    expect(screen.getByTestId('sandbox-tty')).toBeDisabled();
    expect(
      screen.getByText(
        'Applies to a command. The default login shell always gets a terminal.',
      ),
    ).toBeInTheDocument();

    type('sandbox-command-input', 'bash');
    expect(screen.getByTestId('sandbox-tty')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('sandbox-tty'));
    // Taking the command away takes the terminal with it.
    type('sandbox-command-input', '');
    expect(screen.getByTestId('sandbox-tty')).not.toBeChecked();
    submit();

    const request = sentRequest();
    expect(request.command).toBeUndefined();
    expect(request.tty).toBeUndefined();
  });

  it('warns when a whole command line was typed as one argument', () => {
    renderModal();
    type('sandbox-command-input', 'python -m http.server 8080');
    expect(screen.getByTestId('sandbox-command-unsplit')).toHaveTextContent(
      'This is one argument that contains spaces',
    );

    type('sandbox-command-input', 'python\n-m\nhttp.server\n8080');
    expect(
      screen.queryByTestId('sandbox-command-unsplit'),
    ).not.toBeInTheDocument();
  });

  it('sends the runtime class and the driver config as a JSON object', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    type('sandbox-runtime-class-input', ' kata ');
    type(
      'sandbox-driver-config-input',
      '{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}',
    );
    submit();

    const request = sentRequest();
    expect(request.runtimeClassName).toBe('kata');
    expect(request.driverConfig).toEqual({
      kubernetes: { pod: { node_selector: { pool: 'gpu' } } },
    });
  });

  it.each([
    ['{not json', /^Invalid JSON: /],
    ['["kubernetes"]', /must be a JSON object keyed by driver name/],
  ])('refuses %s as a driver config', (text, message) => {
    renderModal();
    type('sandbox-image-input', 'base');
    type('sandbox-driver-config-input', text);

    expect(screen.getByTestId('sandbox-driver-config-help')).toHaveTextContent(
      message,
    );
    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
    submit();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('sends the services to expose, unnamed and named', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    fireEvent.click(screen.getByTestId('sandbox-expose-add'));
    type('sandbox-expose-port-0', '8080');
    fireEvent.click(screen.getByTestId('sandbox-expose-add'));
    type('sandbox-expose-service-1', 'web');
    type('sandbox-expose-port-1', '3000');
    submit();

    expect(sentRequest().serviceExposures).toEqual([
      { targetPort: 8080 },
      { service: 'web', targetPort: 3000 },
    ]);
  });

  it('refuses a port that is not a port', () => {
    renderModal();
    type('sandbox-image-input', 'base');
    fireEvent.click(screen.getByTestId('sandbox-expose-add'));
    type('sandbox-expose-port-0', '70000');

    expect(screen.getByTestId('sandbox-expose-help')).toHaveTextContent(
      'Port must be a whole number from 1 to 65535',
    );
    expect(screen.getByTestId('create-sandbox-submit')).toBeDisabled();
  });
});

describe('CreateSandboxModal approval mode', () => {
  const created = { metadata: { name: 'brave-otter' } };
  const settingsPath =
    '/api/v1/workspaces/team-a/sandboxes/brave-otter/settings';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags = { settings: true };
    mockRole = { isWorkspaceAdmin: true };
    // The gateway accepts the create and answers with the sandbox, whose name
    // it generated.
    mockMutate.mockImplementation((_request, options) =>
      options.onSuccess(created),
    );
  });

  it('writes nothing for manual, the default', async () => {
    renderModal();
    type('sandbox-image-input', 'base');
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockAddSuccess).toHaveBeenCalledWith('Sandbox created');
    // The mode is no field of the create request.
    expect(sentRequest()).not.toHaveProperty('approvalMode');
  });

  it('sets auto on the created sandbox once it exists', async () => {
    mockPut.mockResolvedValue({ updated: true, settingsRevision: 1 });
    renderModal();
    type('sandbox-image-input', 'base');
    type('sandbox-approval-mode', 'auto');
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockPut).toHaveBeenCalledWith(settingsPath, {
      key: 'proposal_approval_mode',
      value: 'auto',
    });
    expect(sentRequest()).not.toHaveProperty('approvalMode');
    expect(mockAddSuccess).toHaveBeenCalledWith('Sandbox created');
  });

  it('keeps the sandbox and says how to retry when the setting is refused', async () => {
    const refusal =
      "setting 'proposal_approval_mode' is managed globally; delete the global setting before sandbox update";
    mockPut.mockRejectedValue(new Error(refusal));
    renderModal();
    type('sandbox-image-input', 'base');
    type('sandbox-approval-mode', 'auto');
    submit();

    const notice = await screen.findByTestId('approval-mode-failure');
    expect(notice).toHaveTextContent(
      'Sandbox "brave-otter" was created, but its approval mode was not set',
    );
    // The gateway's own sentence, and where to try again.
    expect(notice).toHaveTextContent(refusal);
    expect(notice).toHaveTextContent('proposal_approval_mode');
    expect(notice).toHaveTextContent('Settings tab');
    // Not reported as a plain success, and the form is gone: submitting again
    // would create a second sandbox.
    expect(mockAddSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('create-sandbox-submit'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-sandbox-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is not offered to someone the gateway would refuse', () => {
    mockRole = { isWorkspaceAdmin: false };
    renderModal();
    expect(
      screen.queryByTestId('sandbox-approval-mode'),
    ).not.toBeInTheDocument();
  });

  it('is not offered where the settings feature is off', () => {
    mockFlags = { settings: false };
    renderModal();
    expect(
      screen.queryByTestId('sandbox-approval-mode'),
    ).not.toBeInTheDocument();
  });
});
