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
  setGeneratedExpanded: jest.fn(),
  applyTemplate: jest.fn(),
  toggleProvider: jest.fn(),
  reset: jest.fn(),
  buildPayload: jest.fn(() => null),
  setEnvRows: jest.fn(),
  setAnnotationRows: jest.fn(),
  setLogLevel: jest.fn(),
  setRuntimeClassName: jest.fn(),
  setDriverConfigText: jest.fn(),
  setAdvancedExpanded: jest.fn(),
};

// The launch options the form embeds (see useSandboxLaunchOptions), untouched.
const defaultLaunchState = {
  commandText: '',
  setCommandText: jest.fn(),
  command: [] as string[],
  tty: false,
  setTty: jest.fn(),
  exposureRows: [] as { service: string; port: string }[],
  setExposureRows: jest.fn(),
  exposureError: undefined as string | undefined,
  approvalMode: 'manual' as const,
  setApprovalMode: jest.fn(),
  isValid: true,
  payload: {},
  reset: jest.fn(),
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
  isGeneratedExpanded: false,
  hasGeneratedError: false,
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
  envRows: [] as { key: string; value: string }[],
  envError: undefined as string | undefined,
  annotationRows: [] as { key: string; value: string }[],
  annotationsError: undefined as string | undefined,
  logLevel: '',
  runtimeClassName: '',
  driverConfigText: '',
  driverConfigError: undefined as string | undefined,
  isAdvancedExpanded: false,
  hasAdvancedError: false,
  launch: defaultLaunchState,
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

// The approval-mode field asks who is looking before it shows itself.
jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ settings: true })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
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

  // The fields the gateway generates or defaults. The form opens on the
  // policy, the image and the providers, and these are a fold below them.
  describe('the generated fields', () => {
    it('opens on the policy, the image and the providers', () => {
      render(<CreateSandboxModal {...defaultProps} />);
      expect(
        screen.getByTestId('sandbox-policy-template-select'),
      ).toBeVisible();
      expect(screen.getByTestId('sandbox-image-input')).toBeVisible();
      expect(screen.getByTestId('sandbox-name-input')).not.toBeVisible();
      expect(screen.getByTestId('sandbox-labels-input')).not.toBeVisible();
      expect(screen.getByTestId('sandbox-gpu-input')).not.toBeVisible();
    });

    it('shows them when the section is opened', () => {
      currentFormState = { ...defaultFormState, isGeneratedExpanded: true };
      render(<CreateSandboxModal {...defaultProps} />);
      expect(screen.getByTestId('sandbox-name-input')).toBeVisible();
    });

    // Only the name is generated; labels and resources are not, and the
    // toggle does not claim they are.
    it('names the section without claiming it is generated', () => {
      render(<CreateSandboxModal {...defaultProps} />);
      expect(screen.getByTestId('sandbox-generated-expand')).toHaveTextContent(
        'Name, labels and resources',
      );
      expect(screen.queryByText(/generated by default/)).toBeNull();
      expect(
        screen.getByText('A name is generated when this is left empty.'),
      ).toBeInTheDocument();
    });

    // Whatever the section holds is sent, so it is never folded out of
    // sight while it holds anything.
    it.each([
      ['name', { name: 'my-sandbox' }, 'sandbox-name-input'],
      ['labels', { labelsText: 'team=ml' }, 'sandbox-labels-input'],
      ['GPUs', { gpuCount: '1' }, 'sandbox-gpu-input'],
      ['CPU', { cpu: '2' }, 'sandbox-cpu-input'],
      ['memory', { memory: '4Gi' }, 'sandbox-memory-input'],
    ])('stays open while the %s field holds a value', (_field, values, id) => {
      currentFormState = {
        ...defaultFormState,
        ...values,
        isGeneratedExpanded: false,
      };
      render(<CreateSandboxModal {...defaultProps} />);
      expect(screen.getByTestId(id)).toBeVisible();
    });

    // Otherwise a value typed into one of them blocks the form from
    // somewhere nobody can see.
    it('opens by itself around a field that needs correcting', () => {
      currentFormState = {
        ...defaultFormState,
        labels: null,
        hasGeneratedError: true,
      };
      render(<CreateSandboxModal {...defaultProps} />);
      expect(screen.getByTestId('sandbox-labels-input')).toBeVisible();
      expect(
        screen.getByText('Labels must be comma-separated key=value pairs'),
      ).toBeVisible();
    });
  });
});
