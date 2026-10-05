import React from 'react';
import { render, screen } from '@testing-library/react';

import TemplatesTab from '../TemplatesTab';
import type { ApiError } from '../../api/client';

const apiError = (status: number, code: string, message: string): ApiError =>
  Object.assign(new Error(message), { status, code });

type TemplatesQuery = {
  isLoading: boolean;
  isError: boolean;
  error: ApiError | null;
  data: unknown[] | undefined;
  refetch: jest.Mock;
};

const loaded: TemplatesQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: [],
  refetch: jest.fn(),
};

let templatesQuery: TemplatesQuery = loaded;

jest.mock('../../api/templates', () => ({
  useTemplates: jest.fn(() => templatesQuery),
  useDeleteTemplate: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useCreateTemplate: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useCreateSandboxFromTemplate: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({
    isWorkspaceAdmin: true,
    isLoading: false,
  })),
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

describe('TemplatesTab', () => {
  beforeEach(() => {
    templatesQuery = loaded;
  });

  // Gateway 0.0.116 has no template RPCs; the BFF answers 501.
  it('shows a plain "not supported" state when the gateway has no templates', () => {
    templatesQuery = {
      ...loaded,
      isError: true,
      data: undefined,
      error: apiError(
        501,
        'unimplemented',
        'this OpenShell gateway does not support this operation',
      ),
    };
    render(<TemplatesTab workspace="default" />);

    expect(screen.getByTestId('templates-unsupported')).toBeInTheDocument();
    expect(
      screen.getByText(/This gateway does not support sandbox templates/),
    ).toBeInTheDocument();
    // Not an error, and nothing to act on: no alert, no retry, no create.
    expect(
      screen.queryByText('Failed to load templates'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('create-template-empty'),
    ).not.toBeInTheDocument();
  });

  it('still reports any other failure as an error with a retry', () => {
    templatesQuery = {
      ...loaded,
      isError: true,
      data: undefined,
      error: apiError(500, 'internal', 'internal error'),
    };
    render(<TemplatesTab workspace="default" />);

    expect(screen.getByText('Failed to load templates')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });

  // A known limitation, written down in the README: a gateway 0.0.116 that
  // enforces OIDC scopes checks the caller before it finds out that it has no
  // such RPC, and asks for `openshell:all`. A user without that scope gets a
  // 403, so this tab shows the gateway's permission error, not "not
  // supported". If this case starts failing because the tab handles a 403
  // better, change the README notice with it.
  it('shows the permission error, not "not supported", when the gateway denies the call', () => {
    templatesQuery = {
      ...loaded,
      isError: true,
      data: undefined,
      error: apiError(
        403,
        'permission_denied',
        "scope 'openshell:all' required",
      ),
    };
    render(<TemplatesTab workspace="default" />);

    expect(screen.getByText('Failed to load templates')).toBeInTheDocument();
    expect(
      screen.getByText("scope 'openshell:all' required"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });

  it('keeps the ordinary empty state for a gateway that has templates but none yet', () => {
    render(<TemplatesTab workspace="default" />);

    expect(screen.getByText('No templates')).toBeInTheDocument();
    expect(screen.getByTestId('create-template-empty')).toBeInTheDocument();
    expect(
      screen.queryByTestId('templates-unsupported'),
    ).not.toBeInTheDocument();
  });
});
