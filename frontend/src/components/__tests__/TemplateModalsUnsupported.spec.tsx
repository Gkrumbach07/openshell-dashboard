import React from 'react';
import { render, screen } from '@testing-library/react';

import CreateSandboxFromTemplateModal from '../CreateSandboxFromTemplateModal';
import CreateTemplateModal from '../CreateTemplateModal';
import type { ApiError } from '../../api/client';

// Both modals are exported for hosts to open on their own, so either can be
// submitted against a gateway without template RPCs (OpenShell 0.0.116). The
// BFF answers 501 and the modal must say "not supported" rather than
// "Create failed".

const apiError = (status: number, code: string, message: string): ApiError =>
  Object.assign(new Error(message), { status, code });

const unimplemented = apiError(
  501,
  'unimplemented',
  'this OpenShell gateway does not support this operation',
);

type Mutation = {
  mutate: jest.Mock;
  reset: jest.Mock;
  isPending: boolean;
  isError: boolean;
  error: ApiError | null;
};

const idle = (): Mutation => ({
  mutate: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
});

const failed = (error: ApiError): Mutation => ({
  ...idle(),
  isError: true,
  error,
});

let createFromTemplate: Mutation = idle();
let createTemplate: Mutation = idle();

jest.mock('../../api/templates', () => ({
  useCreateSandboxFromTemplate: jest.fn(() => createFromTemplate),
  useCreateTemplate: jest.fn(() => createTemplate),
}));

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

beforeEach(() => {
  createFromTemplate = idle();
  createTemplate = idle();
});

describe('CreateSandboxFromTemplateModal', () => {
  const props = {
    workspace: 'default',
    templateName: 'claude-harness',
    isOpen: true,
    onClose: jest.fn(),
  };

  it('shows the form while nothing has failed', () => {
    render(<CreateSandboxFromTemplateModal {...props} />);

    expect(
      screen.getByTestId('create-from-template-submit'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });

  it('replaces the form with "not supported" when the gateway has no templates', () => {
    createFromTemplate = failed(unimplemented);
    render(<CreateSandboxFromTemplateModal {...props} />);

    expect(screen.getByTestId('templates-unsupported')).toBeInTheDocument();
    expect(
      screen.getByTestId('create-from-template-close'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Create failed')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('create-from-template-submit'),
    ).not.toBeInTheDocument();
  });

  it('still reports any other failure as "Create failed"', () => {
    createFromTemplate = failed(
      apiError(404, 'not_found', 'template not found'),
    );
    render(<CreateSandboxFromTemplateModal {...props} />);

    expect(screen.getByText('Create failed')).toBeInTheDocument();
    expect(screen.getByText('template not found')).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });
});

describe('CreateTemplateModal', () => {
  const props = { workspace: 'default', isOpen: true, onClose: jest.fn() };

  it('replaces the form with "not supported" when the gateway has no templates', () => {
    createTemplate = failed(unimplemented);
    render(<CreateTemplateModal {...props} />);

    expect(screen.getByTestId('templates-unsupported')).toBeInTheDocument();
    expect(screen.getByTestId('create-template-close')).toBeInTheDocument();
    expect(screen.queryByText('Create failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-name-input')).not.toBeInTheDocument();
  });

  it('still reports any other failure as "Create failed"', () => {
    createTemplate = failed(
      apiError(409, 'already_exists', 'template already exists'),
    );
    render(<CreateTemplateModal {...props} />);

    expect(screen.getByText('Create failed')).toBeInTheDocument();
    expect(screen.getByTestId('template-name-input')).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });
});
