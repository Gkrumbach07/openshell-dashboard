import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AlertVariant } from '@patternfly/react-core';

import CreateTemplateModal from '../CreateTemplateModal';
import TemplatesTab from '../TemplatesTab';
import type {
  CreateSandboxTemplateRequest,
  DeleteResult,
  SandboxTemplate,
} from '../../types';

// A workload template does not need an image. `openshell sandbox template
// create` without --image makes one, the CLI lists it as "<default>", and a
// sandbox created from it runs the gateway's default image. What the gateway
// does refuse is a template without a workload.

const mockCreate = jest.fn();
let mockDeleteAnswer: DeleteResult = { outcome: 'completed', deleted: true };
const mockDelete = jest.fn(
  (_name: string, options?: { onSuccess?: (result: DeleteResult) => void }) =>
    options?.onSuccess?.(mockDeleteAnswer),
);

jest.mock('../../api/templates', () => ({
  useTemplates: jest.fn(),
  useCreateTemplate: jest.fn(() => ({
    mutate: mockCreate,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useDeleteTemplate: jest.fn(() => ({
    mutate: mockDelete,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));

const mockAddAlert = jest.fn();
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: mockAddAlert,
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

jest.mock('../CreateSandboxFromTemplateModal', () => ({
  __esModule: true,
  default: () => null,
}));

import { useTemplates } from '../../api/templates';
const mockUseTemplates = useTemplates as jest.Mock;

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

// The request the form sent on its one and only submit, as it goes on the
// wire.
const sentRequest = (): CreateSandboxTemplateRequest => {
  expect(mockCreate).toHaveBeenCalledTimes(1);
  return JSON.parse(
    JSON.stringify(mockCreate.mock.calls[0][0]),
  ) as CreateSandboxTemplateRequest;
};

describe('CreateTemplateModal image', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderModal = () =>
    render(
      <CreateTemplateModal workspace="team-a" isOpen onClose={jest.fn()} />,
    );
  const submitButton = () => screen.getByTestId('create-template-submit');

  it('needs a name and no image', () => {
    renderModal();
    expect(submitButton()).toBeDisabled();
    type('template-name-input', 'default-image');
    expect(submitButton()).toBeEnabled();
    expect(screen.getByTestId('template-image-input')).not.toBeRequired();
  });

  it('sends a workload without an image when the field is left empty', () => {
    renderModal();
    type('template-name-input', 'default-image');
    fireEvent.click(submitButton());

    const request = sentRequest();
    // The workload itself is always there: the gateway refuses a template
    // without one.
    expect(request.spec).toHaveProperty('workload');
    expect(request.spec.workload).not.toHaveProperty('image');
  });

  it('keeps the rest of the workload of a template without an image', () => {
    renderModal();
    type('template-name-input', 'default-image');
    type('template-env-input', 'MODE=test');
    type('template-cpu-input', '500m');
    fireEvent.click(submitButton());

    expect(sentRequest().spec.workload).toEqual({
      environment: { MODE: 'test' },
      resources: { cpu: '500m' },
    });
  });

  it('still sends an image that was typed, resolving a community name', () => {
    renderModal();
    type('template-name-input', 'python-template');
    type('template-image-input', 'python');
    fireEvent.click(submitButton());
    expect(sentRequest().spec.workload?.image).toBe(
      'ghcr.io/nvidia/openshell-community/sandboxes/python:latest',
    );
  });

  it('says what leaving the image empty means', () => {
    renderModal();
    expect(screen.getByTestId('template-image-help')).toHaveTextContent(
      "Leaving it empty uses the gateway's default image for every sandbox created from the template.",
    );
  });
});

describe('TemplatesTab', () => {
  const template = (name: string, image?: string): SandboxTemplate => ({
    metadata: {
      id: `id-${name}`,
      name,
      createdAtMs: Date.now() - 60_000,
      resourceVersion: 1,
    },
    spec: { workload: image ? { image } : {} },
  });

  const renderTab = (...templates: SandboxTemplate[]) => {
    mockUseTemplates.mockReturnValue({
      isLoading: false,
      isError: false,
      data: templates,
    });
    return render(<TemplatesTab workspace="team-a" />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAnswer = { outcome: 'completed', deleted: true };
  });

  it("names the gateway's default for a template without an image", () => {
    renderTab(template('pinned', 'base:1'), template('default-image'));
    expect(screen.getByTestId('template-image-pinned')).toHaveTextContent(
      /^base:1$/,
    );
    expect(
      screen.getByTestId('template-image-default-image'),
    ).toHaveTextContent(/^Gateway default$/);
  });

  it.each<[DeleteResult, AlertVariant, string]>([
    [
      { outcome: 'completed', deleted: true },
      AlertVariant.success,
      'Template "pinned" deleted',
    ],
    [
      { outcome: 'accepted', deleted: false },
      AlertVariant.info,
      'Template "pinned" deletion accepted; cleanup is pending',
    ],
    [
      { outcome: 'already_absent', deleted: true },
      AlertVariant.success,
      'Template "pinned" already deleted',
    ],
  ])(
    'reports a delete as the gateway answered it: $outcome',
    (answer, variant, title) => {
      mockDeleteAnswer = answer;
      renderTab(template('pinned', 'base:1'));
      fireEvent.click(screen.getByRole('button', { name: /kebab toggle/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(screen.getByTestId('confirm-delete'));

      expect(mockDelete).toHaveBeenCalledWith('pinned', expect.anything());
      expect(mockAddAlert).toHaveBeenCalledTimes(1);
      expect(mockAddAlert).toHaveBeenCalledWith(title, variant);
    },
  );
});
