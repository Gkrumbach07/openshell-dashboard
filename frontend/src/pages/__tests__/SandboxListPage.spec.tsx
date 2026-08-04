import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SandboxListPage from '../SandboxListPage';
import type { Sandbox } from '../../types';

const mockSandbox: Sandbox = {
  metadata: {
    id: 'uuid-1',
    name: 'test-sandbox',
    workspace: 'default',
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
    labels: { team: 'ml' },
  },
  spec: {
    image: 'ghcr.io/nvidia/openshell-community/sandboxes/python:latest',
    providers: ['claude'],
    policy: { version: 1, networkPolicies: {} },
  },
  status: {
    phase: 'READY',
    currentPolicyVersion: 1,
  },
};

jest.mock('../../api/sandboxes', () => ({
  useSandboxes: jest.fn(),
  deleteSandbox: jest.fn(),
  useCreateSandbox: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({
    terminal: true,
    fileTransfer: true,
    settings: true,
    globalPolicy: true,
    credentialRefresh: true,
    services: true,
    draftPolicy: true,
    deploymentContext: 'standalone',
    workspaceBinding: false,
    resourceLinks: false,
  })),
}));

jest.mock('../../api/policy', () => ({
  useDraftNotifications: jest.fn(() => ({ items: [], totalPending: 0 })),
  useSandboxPolicies: jest.fn(() => ({})),
}));

jest.mock('../../api/providers', () => ({
  useProviderExpiry: jest.fn(() => ({ expiring: [], expired: [] })),
  useProviders: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({
    addAlert: jest.fn(),
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
  })),
}));

jest.mock('../../hooks/useBulkDelete', () => ({
  useBulkDelete: jest.fn(() => ({
    run: jest.fn(),
    isDeleting: false,
    error: undefined,
    clearError: jest.fn(),
  })),
}));

jest.mock('../../hooks/useJsonValidation', () => ({
  useJsonValidation: jest.fn((text: string) => {
    try {
      return { error: null, parsed: JSON.parse(text) };
    } catch {
      return { error: 'invalid', parsed: null };
    }
  }),
}));

import { useSandboxes } from '../../api/sandboxes';
const mockUseSandboxes = useSandboxes as jest.Mock;

const renderPage = () =>
  render(
    <MemoryRouter>
      <SandboxListPage workspace="default" />
    </MemoryRouter>,
  );

describe('SandboxListPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows spinner during loading', () => {
    mockUseSandboxes.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });
    renderPage();
    expect(screen.getByLabelText('Loading sandboxes')).toBeInTheDocument();
  });

  it('shows error alert on fetch failure', () => {
    mockUseSandboxes.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Gateway unreachable'),
      refetch: jest.fn(),
    });
    renderPage();
    expect(screen.getByText('Failed to load sandboxes')).toBeInTheDocument();
    expect(screen.getByText('Gateway unreachable')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows empty state when no sandboxes exist', () => {
    mockUseSandboxes.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
    });
    renderPage();
    expect(screen.getByText('No sandboxes')).toBeInTheDocument();
    expect(screen.getByTestId('create-sandbox-empty')).toBeInTheDocument();
  });

  it('renders sandbox table with view toggle when sandboxes exist', () => {
    mockUseSandboxes.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [mockSandbox],
    });
    renderPage();
    expect(screen.getByTestId('sandbox-table')).toBeInTheDocument();
    expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('create-sandbox')).toBeInTheDocument();
    expect(screen.getByText('test-sandbox')).toBeInTheDocument();
  });
});
