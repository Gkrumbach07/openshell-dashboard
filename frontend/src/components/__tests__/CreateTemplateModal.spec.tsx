import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CreateTemplateModal from '../CreateTemplateModal';
import type { CreateSandboxTemplateRequest } from '../../types';

const mockMutate = jest.fn();

jest.mock('../../api/templates', () => ({
  useCreateTemplate: jest.fn(() => ({
    mutate: mockMutate,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

const renderModal = () =>
  render(<CreateTemplateModal workspace="team-a" isOpen onClose={jest.fn()} />);

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const fillRequired = () => {
  type('template-name-input', 'claude-harness');
  type('template-image-input', 'base');
};

const submit = () =>
  fireEvent.click(screen.getByTestId('create-template-submit'));

// The request the form sent on its one and only submit.
const sentRequest = (): CreateSandboxTemplateRequest => {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  return mockMutate.mock.calls[0][0] as CreateSandboxTemplateRequest;
};

describe('CreateTemplateModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends no annotations, service level or driver config when they are left alone', () => {
    renderModal();
    fillRequired();
    submit();

    const request = sentRequest();
    expect(request.name).toBe('claude-harness');
    expect(request.annotations).toBeUndefined();
    expect(request.spec.desiredServiceLevel).toBeUndefined();
    expect(request.spec.driverConfig).toBeUndefined();
  });

  it('sends the startup service level in milliseconds', () => {
    renderModal();
    fillRequired();
    type('template-ready-within-input', '5m');
    type('template-max-burst-input', '4');
    submit();

    expect(sentRequest().spec.desiredServiceLevel).toEqual({
      startup: { readyWithinMs: 300_000, maxBurst: 4 },
    });
  });

  it('sends either half of the service level without the other', () => {
    renderModal();
    fillRequired();
    type('template-ready-within-input', '30s');
    submit();
    expect(sentRequest().spec.desiredServiceLevel).toEqual({
      startup: { readyWithinMs: 30_000 },
    });
  });

  it('sends a burst alone', () => {
    renderModal();
    fillRequired();
    type('template-max-burst-input', '2');
    submit();
    expect(sentRequest().spec.desiredServiceLevel).toEqual({
      startup: { maxBurst: 2 },
    });
  });

  it.each(['30', '0s', '1.5m', '5d'])(
    'refuses %p as the time to be ready within',
    (text) => {
      renderModal();
      fillRequired();
      type('template-ready-within-input', text);

      expect(
        screen.getByTestId('template-ready-within-error'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('create-template-submit')).toBeDisabled();
      submit();
      expect(mockMutate).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '-1', '2.5', 'many'])('refuses %p as a burst', (text) => {
    renderModal();
    fillRequired();
    type('template-max-burst-input', text);

    expect(screen.getByTestId('template-max-burst-error')).toBeInTheDocument();
    expect(screen.getByTestId('create-template-submit')).toBeDisabled();
  });

  it('sends annotations', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('template-annotation-add'));
    type('template-annotation-key-0', 'owner');
    type('template-annotation-value-0', 'ml-team, eu=west');
    submit();

    // A value may hold a comma or an equals sign, which the labels field
    // could not carry.
    expect(sentRequest().annotations).toEqual({ owner: 'ml-team, eu=west' });
  });

  it('sends the driver config as a JSON object', () => {
    renderModal();
    fillRequired();
    type(
      'template-driver-config-input',
      '{"kubernetes": {"pod": {"node_selector": {"pool": "gpu"}}}}',
    );
    submit();

    expect(sentRequest().spec.driverConfig).toEqual({
      kubernetes: { pod: { node_selector: { pool: 'gpu' } } },
    });
  });

  it('refuses a driver config that is not a JSON object', () => {
    renderModal();
    fillRequired();
    type('template-driver-config-input', '"kubernetes"');

    expect(screen.getByTestId('template-driver-config-help')).toHaveTextContent(
      'Driver config must be a JSON object keyed by driver name',
    );
    expect(screen.getByTestId('create-template-submit')).toBeDisabled();
  });

  it('still sends the workload it always sent', () => {
    renderModal();
    fillRequired();
    type('template-env-input', 'HARNESS=claude');
    type('template-cpu-input', '500m');
    type('template-memory-input', '512Mi');
    type('template-gpu-input', '1');
    type('template-labels-input', 'team=ml');
    submit();

    const request = sentRequest();
    expect(request.labels).toEqual({ team: 'ml' });
    expect(request.spec.workload).toEqual({
      image: 'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
      environment: { HARNESS: 'claude' },
      resources: { cpu: '500m', memory: '512Mi', gpu: { count: 1 } },
    });
  });
});
