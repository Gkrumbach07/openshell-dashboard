import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CreateWorkspaceModal from '../CreateWorkspaceModal';

const mockMutate = jest.fn();
const mockReset = jest.fn();
let mockError: Error | null = null;

jest.mock('../../api/workspaces', () => ({
  useCreateWorkspace: jest.fn(() => ({
    mutate: mockMutate,
    reset: mockReset,
    isPending: false,
    isError: mockError !== null,
    error: mockError,
  })),
}));

const mockAddSuccess = jest.fn();
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: mockAddSuccess })),
}));

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const addLabel = (index: number, key: string, value: string) => {
  fireEvent.click(screen.getByTestId('workspace-label-add'));
  type(`workspace-label-key-${index}`, key);
  type(`workspace-label-value-${index}`, value);
};

const submit = () =>
  fireEvent.click(screen.getByTestId('create-workspace-submit'));

describe('CreateWorkspaceModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockError = null;
  });

  it('creates a workspace with a name only, as it always has', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    type('workspace-name-input', 'team-a');
    submit();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    // No labels key at all, not an empty map.
    expect(mockMutate.mock.calls[0][0]).toEqual({ name: 'team-a' });
  });

  // `openshell workspace create --name team-a --label env=staging --label
  // owner=ml`.
  it('sends the labels that were entered', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    type('workspace-name-input', 'team-a');
    addLabel(0, 'env', 'staging');
    addLabel(1, 'owner', 'ml');
    submit();

    expect(mockMutate.mock.calls[0][0]).toEqual({
      name: 'team-a',
      labels: { env: 'staging', owner: 'ml' },
    });
  });

  it('leaves out a row without a key and trims what is sent', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    type('workspace-name-input', 'team-a');
    addLabel(0, '  ', 'orphan value');
    addLabel(1, ' env ', ' staging ');
    // A label may have an empty value.
    addLabel(2, 'canary', '');
    submit();

    expect(mockMutate.mock.calls[0][0]).toEqual({
      name: 'team-a',
      labels: { env: 'staging', canary: '' },
    });
  });

  it('sends no labels when every row was removed again', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    type('workspace-name-input', 'team-a');
    addLabel(0, 'env', 'staging');
    fireEvent.click(screen.getByTestId('workspace-label-remove-0'));
    submit();

    expect(mockMutate.mock.calls[0][0]).toEqual({ name: 'team-a' });
  });

  it('cannot be submitted without a name, labels or not', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    addLabel(0, 'env', 'staging');
    expect(screen.getByTestId('create-workspace-submit')).toBeDisabled();
  });

  it('says how long a name may be and that labels are fixed at creation', () => {
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    expect(screen.getByText(/at most 19\s+characters/)).toBeInTheDocument();
    expect(
      screen.getByText(/cannot\s+be changed after the workspace is created/),
    ).toBeInTheDocument();
  });

  it('clears the labels when it closes after a create', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <CreateWorkspaceModal isOpen onClose={onClose} />,
    );
    type('workspace-name-input', 'team-a');
    addLabel(0, 'env', 'staging');
    submit();
    // The mutation reports success through the callback it was given.
    act(() => mockMutate.mock.calls[0][1].onSuccess());

    expect(mockAddSuccess).toHaveBeenCalledWith('Workspace created');
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<CreateWorkspaceModal isOpen onClose={onClose} />);
    expect(screen.getByTestId('workspace-name-input')).toHaveValue('');
    expect(
      screen.queryByTestId('workspace-label-key-0'),
    ).not.toBeInTheDocument();
  });

  it('shows why the gateway refused, and keeps what was entered', () => {
    mockError = new Error('workspace name exceeds maximum length (20 > 19)');
    render(<CreateWorkspaceModal isOpen onClose={jest.fn()} />);
    addLabel(0, 'env', 'staging');

    expect(screen.getByText('Create failed')).toBeInTheDocument();
    expect(
      screen.getByText('workspace name exceeds maximum length (20 > 19)'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('workspace-label-key-0')).toHaveValue('env');
  });
});
