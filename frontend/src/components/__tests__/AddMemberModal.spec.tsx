import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AddMemberModal from '../AddMemberModal';

const mockMutate = jest.fn();
const mockReset = jest.fn();
let mockPending = false;
let mockError: Error | null = null;

jest.mock('../../api/workspaces', () => ({
  useAddMember: jest.fn(() => ({
    mutate: mockMutate,
    reset: mockReset,
    isPending: mockPending,
    isError: mockError !== null,
    error: mockError,
  })),
}));

let mockIsPlatformAdmin = false;
jest.mock('../../api/rbac', () => ({
  useUserRole: jest.fn(() => ({ isPlatformAdmin: mockIsPlatformAdmin })),
}));

const mockAddSuccess = jest.fn();
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: mockAddSuccess })),
}));

const SUBJECT = '3f2a9c1e-5b7d-4e2a-9f10-6c8d2b4a7e11';

const renderModal = (onClose = jest.fn()) =>
  render(<AddMemberModal workspace="team-a" isOpen onClose={onClose} />);

const typeSubject = (value: string) =>
  fireEvent.change(screen.getByTestId('member-subject-input'), {
    target: { value },
  });

const submit = () => fireEvent.click(screen.getByTestId('add-member-submit'));

describe('AddMemberModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPending = false;
    mockError = null;
    mockIsPlatformAdmin = false;
  });

  it('adds the subject as a user by default', () => {
    renderModal();
    typeSubject(SUBJECT);
    submit();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({
      principalSubject: SUBJECT,
      role: 'USER',
    });
  });

  // The gateway matches a subject exactly, and a subject is usually pasted.
  it('sends the subject without the whitespace around it', () => {
    renderModal();
    typeSubject(`  ${SUBJECT}\n`);
    submit();

    expect(mockMutate.mock.calls[0][0].principalSubject).toBe(SUBJECT);
  });

  it('does not add a subject that is only whitespace', () => {
    renderModal();
    typeSubject('   ');

    expect(screen.getByTestId('add-member-submit')).toBeDisabled();
    fireEvent.submit(screen.getByTestId('member-subject-input'));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not send a second request while one is in flight', () => {
    mockPending = true;
    renderModal();
    typeSubject(SUBJECT);
    fireEvent.submit(screen.getByTestId('member-subject-input'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('says where the user finds their subject, by the name the menu uses', () => {
    renderModal();

    const help = screen.getByTestId('member-subject-help');
    expect(help).toHaveTextContent('"Copy my subject ID" in the user menu');
    expect(help).toHaveTextContent('usually not their email address');
    expect(screen.getByTestId('member-subject-input')).toHaveAttribute(
      'aria-describedby',
      'member-subject-help',
    );
  });

  it('does not suggest an email address as the subject', () => {
    renderModal();

    expect(screen.getByTestId('member-subject-input')).not.toHaveAttribute(
      'placeholder',
    );
  });

  it('offers the admin role to a platform admin only', () => {
    const { unmount } = renderModal();
    expect(
      screen.queryByRole('option', { name: 'Admin' }),
    ).not.toBeInTheDocument();
    unmount();

    mockIsPlatformAdmin = true;
    renderModal();
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows why the gateway refused the member', () => {
    mockError = new Error('member already exists in this workspace');
    renderModal();

    expect(
      screen.getByText('member already exists in this workspace'),
    ).toBeInTheDocument();
  });

  it('closes and reports success once the member is added', () => {
    const onClose = jest.fn();
    renderModal(onClose);
    typeSubject(SUBJECT);
    submit();

    act(() => mockMutate.mock.calls[0][1].onSuccess());
    expect(mockAddSuccess).toHaveBeenCalledWith('Member added');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
