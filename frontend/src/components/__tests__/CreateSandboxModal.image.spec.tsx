import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CreateSandboxModal from '../CreateSandboxModal';
import type { CreateSandboxRequest } from '../../types';

// These tests drive the real form state (useCreateSandboxForm) through the
// modal, so what they assert is the request the gateway is sent.
//
// The gateway does not need an image: `openshell sandbox create` sends none
// unless --from names one, and the gateway then runs its default. It does
// need a policy, in practice: a sandbox created without one is accepted and
// never becomes ready.

const mockMutate = jest.fn();

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
  useFeatureFlags: jest.fn(() => ({ settings: false })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));

jest.mock('../../api/client', () => ({
  get: jest.fn(),
  put: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

const renderModal = () =>
  render(<CreateSandboxModal workspace="team-a" isOpen onClose={jest.fn()} />);

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const submitButton = () => screen.getByTestId('create-sandbox-submit');

// The request the form sent on its one and only submit.
const sentRequest = (): CreateSandboxRequest => {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  return mockMutate.mock.calls[0][0] as CreateSandboxRequest;
};

describe('CreateSandboxModal image', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('can be submitted as it opens, with no image', () => {
    renderModal();
    expect(screen.getByTestId('sandbox-image-input')).toHaveValue('');
    expect(submitButton()).toBeEnabled();
  });

  it('sends no image at all when the field is left empty', () => {
    renderModal();
    fireEvent.click(submitButton());

    const request = sentRequest();
    // Absent, not an empty string: nothing for the gateway to resolve.
    expect('image' in request && request.image !== undefined).toBe(false);
    expect(JSON.parse(JSON.stringify(request))).not.toHaveProperty('image');
    // The policy is still sent, and still the starter policy.
    expect(request.policy).toMatchObject({ version: 1, networkPolicies: {} });
  });

  it('treats an image of only spaces as none', () => {
    renderModal();
    type('sandbox-image-input', '   ');
    fireEvent.click(submitButton());
    expect(JSON.parse(JSON.stringify(sentRequest()))).not.toHaveProperty(
      'image',
    );
  });

  it('still sends an image that was typed', () => {
    renderModal();
    type('sandbox-image-input', 'registry.example.test/team/agent:1.2');
    fireEvent.click(submitButton());
    expect(sentRequest().image).toBe('registry.example.test/team/agent:1.2');
  });

  it('still resolves a community sandbox name', () => {
    renderModal();
    type('sandbox-image-input', 'python');
    expect(screen.getByTestId('sandbox-image-help')).toHaveTextContent(
      'Community image — resolves to ghcr.io/nvidia/openshell-community/sandboxes/python:latest',
    );
    fireEvent.click(submitButton());
    expect(sentRequest().image).toBe(
      'ghcr.io/nvidia/openshell-community/sandboxes/python:latest',
    );
  });

  it('says that leaving the image empty uses the gateway default', () => {
    renderModal();
    expect(screen.getByTestId('sandbox-image-help')).toHaveTextContent(
      "Leaving it empty uses the gateway's default image.",
    );
    expect(screen.getByTestId('sandbox-image-input')).toHaveAttribute(
      'placeholder',
      "Leave empty for the gateway's default image",
    );
  });

  it('marks the policy as required and the image as optional', () => {
    renderModal();
    expect(screen.getByTestId('sandbox-image-input')).not.toBeRequired();
    const required = Array.from(
      document.querySelectorAll('.pf-v6-c-form__group'),
    )
      .filter((group) => group.querySelector('.pf-v6-c-form__label-required'))
      .map(
        (group) =>
          group.querySelector('.pf-v6-c-form__label-text')?.textContent,
      );
    expect(required).toContain('Security policy');
    expect(required).not.toContain('Image');
  });

  it('cannot be submitted without a policy', () => {
    renderModal();
    type('sandbox-policy-input', '');
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
