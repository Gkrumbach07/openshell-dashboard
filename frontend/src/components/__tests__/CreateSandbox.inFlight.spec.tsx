import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import CreateSandboxFromTemplateModal from '../CreateSandboxFromTemplateModal';
import CreateSandboxModal from '../CreateSandboxModal';

// A create that is in flight. What follows one that succeeds, the approval
// mode, is written from the form: closing the form while the request is out
// let go of it, and the sandbox was then created in manual mode with nothing
// said. These drive the real form state through each modal.

const mockCreate = jest.fn();
const mockCreateReset = jest.fn();
const mockCreateFromTemplate = jest.fn();
const mockCreateFromTemplateReset = jest.fn();
const mockAddSuccess = jest.fn();
// Whether the request is out, which a test turns on after it submits.
let mockPending = false;

jest.mock('../../api/sandboxes', () => ({
  useCreateSandbox: jest.fn(() => ({
    mutate: mockCreate,
    reset: mockCreateReset,
    isPending: mockPending,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/templates', () => ({
  useCreateSandboxFromTemplate: jest.fn(() => ({
    mutate: mockCreateFromTemplate,
    reset: mockCreateFromTemplateReset,
    isPending: mockPending,
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
    addSuccess: mockAddSuccess,
    addDanger: jest.fn(),
  })),
}));

import { put } from '../../api/client';
const mockPut = put as jest.Mock;

const onClose = jest.fn();

const FORMS = [
  {
    form: 'Create sandbox',
    approvalMode: 'sandbox-approval-mode',
    submit: 'create-sandbox-submit',
    cancel: 'create-sandbox-cancel',
    mutate: mockCreate,
    reset: mockCreateReset,
    element: () => (
      <CreateSandboxModal workspace="team-a" isOpen onClose={onClose} />
    ),
  },
  {
    form: 'Create sandbox from template',
    approvalMode: 'from-template-approval-mode',
    submit: 'create-from-template-submit',
    cancel: 'create-from-template-cancel',
    mutate: mockCreateFromTemplate,
    reset: mockCreateFromTemplateReset,
    element: () => (
      <CreateSandboxFromTemplateModal
        workspace="team-a"
        templateName="claude-harness"
        isOpen
        onClose={onClose}
      />
    ),
  },
];

describe.each(FORMS)(
  '$form: a create in flight',
  ({ approvalMode, submit, cancel, mutate, reset, element }) => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockPending = false;
    });

    const closeButton = () => screen.queryByRole('button', { name: 'Close' });
    // The modal listens for Escape where it is mounted, on the body.
    const pressEscape = () =>
      fireEvent.keyDown(document.body, { key: 'Escape' });

    it('cannot be closed, so the approval mode that follows is still set', async () => {
      mockPut.mockResolvedValue({ updated: true, settingsRevision: 1 });
      const { rerender } = render(element());
      fireEvent.change(screen.getByTestId(approvalMode), {
        target: { value: 'auto' },
      });
      fireEvent.click(screen.getByTestId(submit));
      expect(mutate).toHaveBeenCalledTimes(1);

      // The request is out.
      mockPending = true;
      rerender(element());

      // No way to close the form: not Cancel, not the X, not Escape.
      expect(screen.getByTestId(cancel)).toBeDisabled();
      fireEvent.click(screen.getByTestId(cancel));
      expect(closeButton()).not.toBeInTheDocument();
      pressEscape();
      expect(onClose).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();

      // The sandbox is created. The mode that was chosen is written to it,
      // and only then does the form close.
      const { onSuccess } = mutate.mock.calls[0][1] as {
        onSuccess: (sandbox: { metadata: { name: string } }) => Promise<void>;
      };
      await act(() => onSuccess({ metadata: { name: 'agent-7' } }));
      expect(mockPut).toHaveBeenCalledWith(
        '/api/v1/workspaces/team-a/sandboxes/agent-7/settings',
        { key: 'proposal_approval_mode', value: 'auto' },
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockAddSuccess).toHaveBeenCalledTimes(1);
    });

    it('can be closed when nothing is in flight', () => {
      render(element());
      expect(closeButton()).toBeInTheDocument();
      expect(screen.getByTestId(cancel)).toBeEnabled();
      fireEvent.click(screen.getByTestId(cancel));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('can be closed with Escape or the X when nothing is in flight', () => {
      render(element());
      pressEscape();
      expect(onClose).toHaveBeenCalledTimes(1);
      const close = closeButton();
      if (!close) throw new Error('the form has no close button');
      fireEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  },
);
