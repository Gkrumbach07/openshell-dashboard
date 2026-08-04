import React from 'react';
import { render, screen } from '@testing-library/react';
import CreateSandboxModal from '../CreateSandboxModal';

const mockMutate = jest.fn();
const mockFormSetters = {
  setName: jest.fn(),
  setImage: jest.fn(),
  setLabelsText: jest.fn(),
  setGpuCount: jest.fn(),
  setCpu: jest.fn(),
  setMemory: jest.fn(),
  setPolicyText: jest.fn(),
  setPolicyExpanded: jest.fn(),
  applyTemplate: jest.fn(),
  toggleProvider: jest.fn(),
  reset: jest.fn(),
  buildPayload: jest.fn(() => null),
};

const defaultFormState = {
  name: '',
  image: '',
  labelsText: '',
  gpuCount: '',
  cpu: '',
  memory: '',
  templateId: 'locked-down',
  policyText: '{}',
  selectedProviders: [] as string[],
  isPolicyExpanded: false,
  policyError: null as string | null,
  parsedPolicy: {},
  labels: {} as Record<string, string> | null,
  gpuInvalid: false,
  resolvedImage: '',
  isResolved: false,
  activeTemplate: {
    id: 'locked-down',
    name: 'Locked down (no network)',
    description: 'Standard sandbox with no network egress.',
    policy: { version: 1, networkPolicies: {} },
  },
  isValid: false,
  ...mockFormSetters,
};

let currentFormState = { ...defaultFormState };

jest.mock('../../hooks/useCreateSandboxForm', () => ({
  useCreateSandboxForm: jest.fn(() => currentFormState),
}));

jest.mock('../policy/policyTemplates', () => ({
  policyTemplates: [
    {
      id: 'locked-down',
      name: 'Locked down (no network)',
      description: 'Standard sandbox with no network egress.',
      policy: { version: 1, networkPolicies: {} },
    },
  ],
}));

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
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

const defaultProps = {
  workspace: 'default',
  isOpen: true,
  onClose: jest.fn(),
};

describe('CreateSandboxModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentFormState = { ...defaultFormState };
  });

  it('renders the modal with required form fields', () => {
    render(<CreateSandboxModal {...defaultProps} />);
    expect(screen.getByText('Create sandbox')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-image-input')).toBeInTheDocument();
    expect(
      screen.getByTestId('sandbox-policy-template-select'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('create-sandbox-submit')).toBeInTheDocument();
  });

  it('disables create button when form is not valid', () => {
    currentFormState = { ...defaultFormState, isValid: false };
    render(<CreateSandboxModal {...defaultProps} />);
    const submit = screen.getByTestId('create-sandbox-submit');
    expect(submit).toBeDisabled();
  });

  it('enables create button when form is valid', () => {
    currentFormState = { ...defaultFormState, isValid: true, image: 'python' };
    render(<CreateSandboxModal {...defaultProps} />);
    const submit = screen.getByTestId('create-sandbox-submit');
    expect(submit).not.toBeDisabled();
  });

  it('renders policy template selector', () => {
    render(<CreateSandboxModal {...defaultProps} />);
    const select = screen.getByTestId('sandbox-policy-template-select');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('locked-down');
  });

  it('renders resource input fields', () => {
    render(<CreateSandboxModal {...defaultProps} />);
    expect(screen.getByTestId('sandbox-gpu-input')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-cpu-input')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-memory-input')).toBeInTheDocument();
  });

  it('renders labels input', () => {
    render(<CreateSandboxModal {...defaultProps} />);
    expect(screen.getByTestId('sandbox-labels-input')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<CreateSandboxModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Create sandbox')).not.toBeInTheDocument();
  });

  it('shows label validation error when labels are invalid', () => {
    currentFormState = { ...defaultFormState, labels: null };
    render(<CreateSandboxModal {...defaultProps} />);
    expect(
      screen.getByText('Labels must be comma-separated key=value pairs'),
    ).toBeInTheDocument();
  });

  it('shows GPU validation error when gpuInvalid is true', () => {
    currentFormState = { ...defaultFormState, gpuInvalid: true };
    render(<CreateSandboxModal {...defaultProps} />);
    expect(
      screen.getByText('GPU count must be a whole number'),
    ).toBeInTheDocument();
  });
});
