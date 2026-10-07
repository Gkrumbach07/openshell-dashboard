import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import WorkspaceDetailPage from '../WorkspaceDetailPage';
import type { ServiceEndpoint, Workspace } from '../../types';

// The tabs that belong to other resources are not what is under test here.
jest.mock('../SandboxListPage', () => ({
  __esModule: true,
  default: () => <div data-testid="sandbox-list" />,
}));
jest.mock('../ProviderListPage', () => ({
  __esModule: true,
  default: () => <div data-testid="provider-list" />,
}));
jest.mock('../MemberListPage', () => ({
  __esModule: true,
  default: () => <div data-testid="member-list" />,
}));
jest.mock('../../components/TemplatesTab', () => ({
  __esModule: true,
  default: () => <div data-testid="templates-tab" />,
}));
jest.mock('../../components/provider/ProfilesTab', () => ({
  __esModule: true,
  default: () => <div data-testid="profiles-tab" />,
}));

jest.mock('../../api/providers', () => ({
  useProviders: jest.fn(() => ({ data: [] })),
}));
jest.mock('../../api/sandboxes', () => ({
  useSandboxes: jest.fn(() => ({ data: [] })),
}));
jest.mock('../../api/templates', () => ({
  useTemplates: jest.fn(() => ({ data: [] })),
}));
jest.mock('../../api/workspaces', () => ({
  useWorkspace: jest.fn(),
  useMembers: jest.fn(() => ({ data: [] })),
  useWorkspaceServices: jest.fn(),
}));
let mockServicesFeature = true;
jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ services: mockServicesFeature })),
}));
jest.mock('../../slots', () => ({
  useSlots: jest.fn(() => ({})),
}));

import { useWorkspace, useWorkspaceServices } from '../../api/workspaces';
const mockUseWorkspace = useWorkspace as jest.Mock;
const mockUseWorkspaceServices = useWorkspaceServices as jest.Mock;

const createdAtMs = Date.UTC(2026, 8, 30, 12, 0, 0);

const workspace: Workspace = {
  metadata: {
    id: '0b9d2f6e-6f0f-4b0b-9c40-3d1f8a9f6a11',
    name: 'team-a',
    labels: { env: 'staging', owner: 'ml' },
    createdAtMs,
    resourceVersion: 7,
  },
  phase: 'ACTIVE',
};

const endpoints: ServiceEndpoint[] = [
  {
    id: 'ep-1',
    workspace: 'team-a',
    sandboxName: 'agent',
    serviceName: 'web',
    targetPort: 8080,
    domain: true,
    url: 'https://team-a--agent--web.example/',
  },
  {
    id: 'ep-2',
    workspace: 'team-a',
    sandboxName: 'other',
    serviceName: '',
    targetPort: 3000,
    domain: true,
  },
];

const Location: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
};

const renderPage = (
  props: Partial<React.ComponentProps<typeof WorkspaceDetailPage>> = {},
) =>
  render(
    <MemoryRouter
      initialEntries={['/workspaces/team-a']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path="/workspaces/:workspace"
          element={<WorkspaceDetailPage workspace="team-a" {...props} />}
        />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );

describe('WorkspaceDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServicesFeature = true;
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      isError: false,
      data: workspace,
    });
    mockUseWorkspaceServices.mockReturnValue({
      isLoading: false,
      isError: false,
      data: endpoints,
      refetch: jest.fn(),
    });
  });

  // What `openshell workspace get` prints: name, id, resource version,
  // creation time and labels.
  it('shows the id, resource version, creation time and labels', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'team-a' }),
    ).toBeInTheDocument();
    const details = within(screen.getByTestId('workspace-details'));
    const value = (term: string) =>
      details.getByText(term).closest('.pf-v6-c-description-list__group');

    expect(value('ID')).toHaveTextContent(
      '0b9d2f6e-6f0f-4b0b-9c40-3d1f8a9f6a11',
    );
    expect(value('Resource version')).toHaveTextContent('7');
    expect(value('Created')).toHaveTextContent(
      new Date(createdAtMs).toLocaleString(),
    );
    expect(value('Labels')).toHaveTextContent('env=staging');
    expect(value('Labels')).toHaveTextContent('owner=ml');
  });

  it('shows a dash for a workspace without labels', () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        ...workspace,
        metadata: { ...workspace.metadata, labels: undefined },
      },
    });
    renderPage();

    const labels = within(screen.getByTestId('workspace-details'))
      .getByText('Labels')
      .closest('.pf-v6-c-description-list__group');
    expect(labels).toHaveTextContent('Labels-');
  });

  // `openshell service list` without a sandbox: every endpoint in the
  // workspace, the unnamed one shown the way the CLI shows it.
  it('lists the service endpoints of the whole workspace', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Services/ }));

    expect(mockUseWorkspaceServices).toHaveBeenCalledWith('team-a', {
      enabled: true,
    });
    const table = within(screen.getByTestId('workspace-services-table'));
    const headers = table
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    // No workspace column: every endpoint is in this one.
    expect(headers).toEqual(['Sandbox', 'Service', 'Target', 'URL']);

    const rows = table.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('agent');
    expect(rows[0]).toHaveTextContent('web');
    expect(rows[0]).toHaveTextContent('127.0.0.1:8080');
    expect(within(rows[0]).getByRole('link')).toHaveAttribute(
      'href',
      'https://team-a--agent--web.example/',
    );
    expect(rows[1]).toHaveTextContent('other');
    expect(rows[1]).toHaveTextContent('127.0.0.1:3000');
    expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent(/^-$/);
  });

  it('counts the endpoints on the tab', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Services/ })).toHaveTextContent(
      'Services 2',
    );
  });

  // An endpoint is exposed and deleted on its sandbox, so the sandbox column
  // leads to that sandbox's Services tab.
  it('opens the Services tab of the sandbox an endpoint belongs to', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Services/ }));

    fireEvent.click(screen.getByTestId('service-sandbox-link-team-a-other'));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/workspaces/team-a/sandboxes/other?tab=services',
    );
  });

  it('hands the navigation to onViewSandbox when the host provides it', () => {
    const onViewSandbox = jest.fn();
    renderPage({ onViewSandbox });
    fireEvent.click(screen.getByRole('tab', { name: /Services/ }));

    fireEvent.click(screen.getByTestId('service-sandbox-link-team-a-agent'));

    expect(onViewSandbox).toHaveBeenCalledWith('agent', 'services');
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-a$/,
    );
  });

  it('has no Services tab, and fetches nothing, where services are off', () => {
    mockServicesFeature = false;
    renderPage();

    expect(
      screen.queryByRole('tab', { name: /Services/ }),
    ).not.toBeInTheDocument();
    expect(mockUseWorkspaceServices).toHaveBeenCalledWith('team-a', {
      enabled: false,
    });
  });

  it('shows the error when the workspace cannot be loaded', () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("workspace 'team-a' not found"),
      refetch: jest.fn(),
    });
    renderPage();

    expect(
      screen.getByText('Failed to load workspace team-a'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workspace 'team-a' not found"),
    ).toBeInTheDocument();
  });
});
