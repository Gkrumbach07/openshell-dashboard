import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateSandboxFromTemplateModal from '../CreateSandboxFromTemplateModal';
import type { CreateSandboxFromTemplateRequest } from '../../types';

const mockMutate = jest.fn();
const mockAddSuccess = jest.fn();
let mockRole = { isWorkspaceAdmin: true };

jest.mock('../../api/templates', () => ({
  useCreateSandboxFromTemplate: jest.fn(() => ({
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
  useFeatureFlags: jest.fn(() => ({ settings: true })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => mockRole),
}));

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
  render(
    <CreateSandboxFromTemplateModal
      workspace="team-a"
      templateName="claude-harness"
      isOpen
      onClose={onClose}
    />,
  );

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const submit = () =>
  fireEvent.click(screen.getByTestId('create-from-template-submit'));

// The request the form sent on its one and only submit.
const sentRequest = (): CreateSandboxFromTemplateRequest => {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  return mockMutate.mock.calls[0][0] as CreateSandboxFromTemplateRequest;
};

describe('CreateSandboxFromTemplateModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = { isWorkspaceAdmin: true };
  });

  it('sends the template, a policy and nothing else when the rest is left alone', () => {
    renderModal();
    submit();

    const request = sentRequest();
    expect(request.templateName).toBe('claude-harness');
    expect(request.policy).toBeDefined();
    for (const option of [
      'name',
      'labels',
      'annotations',
      'providers',
      'command',
      'tty',
      'serviceExposures',
    ] as const) {
      expect(request[option]).toBeUndefined();
    }
  });

  it('sends the labels and annotations of the sandbox', () => {
    renderModal();
    type('from-template-labels-input', 'team=ml, kind=agent');
    fireEvent.click(screen.getByTestId('from-template-annotation-add'));
    type('from-template-annotation-key-0', 'owner');
    type('from-template-annotation-value-0', 'ml-team');
    submit();

    const request = sentRequest();
    expect(request.labels).toEqual({ team: 'ml', kind: 'agent' });
    expect(request.annotations).toEqual({ owner: 'ml-team' });
  });

  it('refuses labels that are not key=value pairs', () => {
    renderModal();
    type('from-template-labels-input', 'team');

    expect(
      screen.getByText('Labels must be comma-separated key=value pairs'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('create-from-template-submit')).toBeDisabled();
    submit();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('sends the command and the services to expose, which a template does not hold', () => {
    renderModal();
    type('from-template-command-input', 'claude\n--print');
    fireEvent.click(screen.getByTestId('from-template-tty'));
    fireEvent.click(screen.getByTestId('from-template-expose-add'));
    type('from-template-expose-port-0', '8080');
    submit();

    const request = sentRequest();
    expect(request.command).toEqual(['claude', '--print']);
    expect(request.tty).toBe(true);
    expect(request.serviceExposures).toEqual([{ targetPort: 8080 }]);
    // Nothing of the workload: the gateway refuses it beside a template.
    expect(request).not.toHaveProperty('image');
    expect(request).not.toHaveProperty('environment');
  });

  it('sets the approval mode on the created sandbox, and reports a refusal', async () => {
    const refusal = 'caller is not a workspace admin';
    mockMutate.mockImplementation((_request, options) =>
      options.onSuccess({ metadata: { name: 'agent-7' } }),
    );
    mockPut.mockRejectedValue(new Error(refusal));
    renderModal();
    type('from-template-approval-mode', 'auto');
    submit();

    const notice = await screen.findByTestId('approval-mode-failure');
    expect(mockPut).toHaveBeenCalledWith(
      '/api/v1/workspaces/team-a/sandboxes/agent-7/settings',
      { key: 'proposal_approval_mode', value: 'auto' },
    );
    expect(notice).toHaveTextContent(
      'Sandbox "agent-7" was created, but its approval mode was not set',
    );
    expect(notice).toHaveTextContent(refusal);
    expect(mockAddSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-from-template-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with a success once the approval mode is set', async () => {
    mockMutate.mockImplementation((_request, options) =>
      options.onSuccess({ metadata: { name: 'agent-7' } }),
    );
    mockPut.mockResolvedValue({ updated: true, settingsRevision: 1 });
    renderModal();
    type('from-template-approval-mode', 'auto');
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockAddSuccess).toHaveBeenCalledWith(
      'Sandbox created from template "claude-harness"',
    );
  });

  it('does not offer the approval mode to someone the gateway would refuse', () => {
    mockRole = { isWorkspaceAdmin: false };
    renderModal();
    expect(
      screen.queryByTestId('from-template-approval-mode'),
    ).not.toBeInTheDocument();
  });
});
