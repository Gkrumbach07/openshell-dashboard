import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AllWorkspacesPage from '../AllWorkspacesPage';
import type {
  Provider,
  Sandbox,
  SandboxTemplate,
  ServiceEndpoint,
} from '../../types';

jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(),
  useAllProviders: jest.fn(),
  useAllTemplates: jest.fn(),
  useAllServices: jest.fn(),
}));

let mockServicesFeature = true;
jest.mock('../../api/auth', () => ({
  useFeatureFlags: jest.fn(() => ({ services: mockServicesFeature })),
}));

import {
  useAllProviders,
  useAllSandboxes,
  useAllServices,
  useAllTemplates,
} from '../../api/allWorkspaces';
const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseAllProviders = useAllProviders as jest.Mock;
const mockUseAllTemplates = useAllTemplates as jest.Mock;
const mockUseAllServices = useAllServices as jest.Mock;

const meta = (workspace: string, name: string) => ({
  id: `${workspace}-${name}`,
  name,
  workspace,
  createdAtMs: Date.now() - 120_000,
  resourceVersion: 1,
});

const sandbox = (
  workspace: string,
  name: string,
  phase: Sandbox['status']['phase'],
  labels?: Record<string, string>,
): Sandbox => ({
  metadata: { ...meta(workspace, name), labels },
  spec: { image: 'ghcr.io/nvidia/openshell-community/sandboxes/base:latest' },
  status: { phase, currentPolicyVersion: 1 },
});

// The same name in two workspaces: only the workspace tells the rows apart.
const sandboxes = [
  sandbox('team-a', 'agent', 'READY', { team: 'ml' }),
  sandbox('team-b', 'agent', 'STOPPED'),
  sandbox('team-b', 'builder', 'ERROR', { team: 'ml' }),
];

const providers: Provider[] = [
  {
    metadata: meta('team-a', 'claude'),
    type: 'claude',
    credentialNames: ['ANTHROPIC_API_KEY'],
    config: { region: 'us', tier: 'pro' },
  },
  { metadata: meta('team-b', 'claude'), type: 'claude' },
];

const templates: SandboxTemplate[] = [
  {
    metadata: { ...meta('team-a', 'python'), labels: { lang: 'python' } },
    spec: { workload: { image: 'example.com/python:3.12' } },
  },
  { metadata: meta('team-b', 'python'), spec: {} },
];

const services: ServiceEndpoint[] = [
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
    workspace: 'team-b',
    sandboxName: 'agent',
    serviceName: '',
    targetPort: 3000,
    domain: true,
  },
];

const ok = <T,>(data: T[]) => ({
  isLoading: false,
  isError: false,
  error: null,
  data,
  refetch: jest.fn(),
});

const failed = (message: string) => ({
  isLoading: false,
  isError: true,
  error: new Error(message),
  data: undefined,
  refetch: jest.fn(),
});

const Location: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
};

const renderPage = (
  props: React.ComponentProps<typeof AllWorkspacesPage> = {},
) =>
  render(
    <MemoryRouter
      initialEntries={['/all-workspaces']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AllWorkspacesPage {...props} />
      <Location />
    </MemoryRouter>,
  );

const headersOf = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('columnheader')
    .map((header) => header.textContent);

const rowsOf = (testId: string) =>
  within(screen.getByTestId(testId)).getAllByRole('row').slice(1);

const openTab = (name: RegExp) =>
  fireEvent.click(screen.getByRole('tab', { name }));

describe('AllWorkspacesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServicesFeature = true;
    mockUseAllSandboxes.mockReturnValue(ok(sandboxes));
    mockUseAllProviders.mockReturnValue(ok(providers));
    mockUseAllTemplates.mockReturnValue(ok(templates));
    mockUseAllServices.mockReturnValue(ok(services));
  });

  // `openshell sandbox list --all-workspaces`: WORKSPACE, NAME, CREATED,
  // PHASE.
  it('lists the sandboxes of every workspace with a workspace column', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'All workspaces' }),
    ).toBeInTheDocument();
    expect(headersOf('all-sandboxes-table')).toEqual([
      'Workspace',
      'Name',
      'Status',
      'Image',
      'Labels',
      'Age',
    ]);
    const rows = rowsOf('all-sandboxes-table');
    expect(rows).toHaveLength(3);
    // Two sandboxes named agent, each in its own workspace.
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(0, 3)
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['team-a', 'agent', 'READY'],
      ['team-b', 'agent', 'STOPPED'],
      ['team-b', 'builder', 'ERROR'],
    ]);
    expect(rows[0]).toHaveTextContent('team=ml');
    // The image column cuts a long reference short, so the whole of it is
    // also the cell's title.
    const image = within(rows[0]).getByTitle(
      'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
    );
    expect(image).toHaveTextContent(
      'ghcr.io/nvidia/openshell-community/sandboxes/base:latest',
    );
    expect(image.closest('td')).toHaveClass('pf-m-truncate');
  });

  it('counts each list on its tab', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Sandboxes/ })).toHaveTextContent(
      'Sandboxes 3',
    );
    expect(screen.getByRole('tab', { name: /Providers/ })).toHaveTextContent(
      'Providers 2',
    );
    expect(screen.getByRole('tab', { name: /Templates/ })).toHaveTextContent(
      'Templates 2',
    );
    expect(screen.getByRole('tab', { name: /Services/ })).toHaveTextContent(
      'Services 2',
    );
  });

  // A row leads to the workspace-scoped page of the sandbox it is: the one in
  // its own workspace, not another of the same name.
  it('opens a sandbox in the workspace it belongs to', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('sandbox-link-team-b/agent'));

    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-b\/sandboxes\/agent$/,
    );
  });

  it('opens the workspace from the workspace column', () => {
    renderPage();
    const firstRow = rowsOf('all-sandboxes-table')[0];

    fireEvent.click(within(firstRow).getByRole('button', { name: 'team-a' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-a$/,
    );
  });

  it('hands navigation to the host when it provides callbacks', () => {
    const onSelectSandbox = jest.fn();
    const onSelectWorkspace = jest.fn();
    const onSelectProvider = jest.fn();
    renderPage({ onSelectSandbox, onSelectWorkspace, onSelectProvider });

    fireEvent.click(screen.getByTestId('sandbox-link-team-b/builder'));
    expect(onSelectSandbox).toHaveBeenCalledWith('team-b', 'builder');

    fireEvent.click(
      within(rowsOf('all-sandboxes-table')[0]).getByRole('button', {
        name: 'team-a',
      }),
    );
    expect(onSelectWorkspace).toHaveBeenCalledWith('team-a');

    openTab(/Providers/);
    fireEvent.click(screen.getByTestId('provider-link-team-b/claude'));
    expect(onSelectProvider).toHaveBeenCalledWith('team-b', 'claude');

    openTab(/Services/);
    fireEvent.click(screen.getByTestId('service-sandbox-link-team-b-agent'));
    expect(onSelectSandbox).toHaveBeenLastCalledWith(
      'team-b',
      'agent',
      'services',
    );
    // The router was left alone.
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/all-workspaces$/,
    );
  });

  it('filters the rows by workspace or name as it is typed', () => {
    renderPage();
    const filter = screen.getByRole('textbox', { name: 'Filter sandboxes' });

    fireEvent.change(filter, { target: { value: 'team-b' } });
    expect(rowsOf('all-sandboxes-table')).toHaveLength(2);

    fireEvent.change(filter, { target: { value: 'team-b/build' } });
    const rows = rowsOf('all-sandboxes-table');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('builder');

    fireEvent.change(filter, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No sandboxes match this filter.')).toBeVisible();
  });

  // `--selector`: the gateway applies it, so it goes to the request when it
  // is submitted.
  it('asks the gateway for the label selector that is submitted', () => {
    mockUseAllSandboxes.mockImplementation((selector?: string) =>
      ok(selector === 'team=ml' ? [sandboxes[0], sandboxes[2]] : sandboxes),
    );
    renderPage();
    const selector = screen.getByRole('textbox', {
      name: 'Filter sandboxes by label selector',
    });

    fireEvent.change(selector, { target: { value: 'team=ml' } });
    expect(mockUseAllSandboxes).toHaveBeenLastCalledWith(undefined);
    fireEvent.keyDown(selector, { key: 'Enter' });

    expect(mockUseAllSandboxes).toHaveBeenLastCalledWith('team=ml');
    expect(rowsOf('all-sandboxes-table')).toHaveLength(2);
    // Templates keep their own selector.
    expect(mockUseAllTemplates).toHaveBeenLastCalledWith(undefined);
  });

  it('shows why a label selector was refused and keeps the box', () => {
    mockUseAllSandboxes.mockImplementation((selector?: string) =>
      selector
        ? failed("invalid label selector: expected 'key=value', got 'team'")
        : ok(sandboxes),
    );
    renderPage();
    const selector = screen.getByRole('textbox', {
      name: 'Filter sandboxes by label selector',
    });

    fireEvent.change(selector, { target: { value: 'team' } });
    fireEvent.keyDown(selector, { key: 'Enter' });

    expect(screen.getByTestId('all-sandboxes-error')).toHaveTextContent(
      "invalid label selector: expected 'key=value', got 'team'",
    );
    expect(
      screen.getByRole('textbox', {
        name: 'Filter sandboxes by label selector',
      }),
    ).toHaveValue('team');
  });

  // The gateway answers these lists for platform admins only. The page does
  // not second-guess it: the refusal is shown as the gateway worded it.
  it("shows the gateway's refusal as it is", () => {
    mockUseAllSandboxes.mockReturnValue(
      failed("role 'openshell-admin' required"),
    );
    renderPage();

    const alert = screen.getByTestId('all-sandboxes-error');
    expect(alert).toHaveTextContent('Failed to load sandboxes');
    expect(alert).toHaveTextContent("role 'openshell-admin' required");
    expect(screen.queryByTestId('all-sandboxes-table')).not.toBeInTheDocument();
    // The other lists are their own requests and are not hidden by it.
    openTab(/Providers/);
    expect(rowsOf('all-providers-table')).toHaveLength(2);
  });

  it('retries a failed list', () => {
    const refetch = jest.fn();
    mockUseAllSandboxes.mockReturnValue({ ...failed('boom'), refetch });
    renderPage();

    fireEvent.click(
      within(screen.getByTestId('all-sandboxes-error')).getByRole('button', {
        name: 'Retry',
      }),
    );

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says so when no workspace has a sandbox', () => {
    mockUseAllSandboxes.mockReturnValue(ok([]));
    renderPage();

    expect(screen.getByTestId('all-sandboxes-empty')).toHaveTextContent(
      'No workspace on this gateway has a sandbox.',
    );
  });

  // `openshell provider list --all-workspaces`: WORKSPACE, NAME, TYPE,
  // CREDENTIAL_KEYS, CONFIG_KEYS.
  it('lists the providers of every workspace', () => {
    renderPage();
    openTab(/Providers/);

    expect(headersOf('all-providers-table')).toEqual([
      'Workspace',
      'Name',
      'Type',
      'Credentials',
      'Config keys',
      'Age',
    ]);
    const cells = rowsOf('all-providers-table').map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 5)
        .map((cell) => cell.textContent),
    );
    expect(cells).toEqual([
      ['team-a', 'claude', 'claude', 'ANTHROPIC_API_KEY', '2'],
      ['team-b', 'claude', 'claude', '-', '0'],
    ]);

    fireEvent.click(screen.getByTestId('provider-link-team-a/claude'));
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-a\/providers\/claude$/,
    );
  });

  it('lists the templates of every workspace, with their own selector', () => {
    renderPage();
    openTab(/Templates/);

    expect(headersOf('all-templates-table')).toEqual([
      'Workspace',
      'Name',
      'Image',
      'Labels',
      'Age',
    ]);
    const rows = rowsOf('all-templates-table');
    expect(rows[0]).toHaveTextContent('team-a');
    expect(rows[0]).toHaveTextContent('example.com/python:3.12');
    expect(rows[0]).toHaveTextContent('lang=python');
    expect(rows[1]).toHaveTextContent('team-b');

    const selector = screen.getByRole('textbox', {
      name: 'Filter templates by label selector',
    });
    fireEvent.change(selector, { target: { value: 'lang=python' } });
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(mockUseAllTemplates).toHaveBeenLastCalledWith('lang=python');
    expect(mockUseAllSandboxes).toHaveBeenLastCalledWith(undefined);
  });

  // `openshell service list --all-workspaces`: WORKSPACE, SANDBOX, SERVICE,
  // TARGET, URL, with "-" for the unnamed service.
  it('lists the service endpoints of every workspace', () => {
    renderPage();
    openTab(/Services/);

    expect(headersOf('all-services-table')).toEqual([
      'Workspace',
      'Sandbox',
      'Service',
      'Target',
      'URL',
    ]);
    const cells = rowsOf('all-services-table').map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent?.trim()),
    );
    expect(cells).toEqual([
      [
        'team-a',
        'agent',
        'web',
        '127.0.0.1:8080',
        'https://team-a--agent--web.example/',
      ],
      ['team-b', 'agent', '-', '127.0.0.1:3000', '-'],
    ]);

    fireEvent.click(screen.getByTestId('service-sandbox-link-team-b-agent'));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/workspaces/team-b/sandboxes/agent?tab=services',
    );
  });

  it('has no Services tab, and fetches nothing, where services are off', () => {
    mockServicesFeature = false;
    renderPage();

    expect(
      screen.queryByRole('tab', { name: /Services/ }),
    ).not.toBeInTheDocument();
    expect(mockUseAllServices).toHaveBeenCalledWith({ enabled: false });
  });
});
