import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AllWorkspacesPage from '../AllWorkspacesPage';
import type { Provider, SandboxTemplate, ServiceEndpoint } from '../../types';

jest.mock('../../api/allWorkspaces', () => ({
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
  useAllServices,
  useAllTemplates,
} from '../../api/allWorkspaces';
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
    mockUseAllProviders.mockReturnValue(ok(providers));
    mockUseAllTemplates.mockReturnValue(ok(templates));
    mockUseAllServices.mockReturnValue(ok(services));
  });

  it('opens on providers, and no longer lists sandboxes', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Resources' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Providers, templates and services across every workspace on the gateway.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: /Sandboxes/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('all-providers-table')).toBeInTheDocument();
  });

  it('counts the providers, templates and services on their tabs', () => {
    renderPage();
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

  it('hands navigation to the host when it provides callbacks', () => {
    const onSelectSandbox = jest.fn();
    const onSelectWorkspace = jest.fn();
    const onSelectProvider = jest.fn();
    renderPage({ onSelectSandbox, onSelectWorkspace, onSelectProvider });

    fireEvent.click(
      within(rowsOf('all-providers-table')[0]).getByRole('button', {
        name: 'team-a',
      }),
    );
    expect(onSelectWorkspace).toHaveBeenCalledWith('team-a');

    fireEvent.click(screen.getByTestId('provider-link-team-b/claude'));
    expect(onSelectProvider).toHaveBeenCalledWith('team-b', 'claude');

    openTab(/Services/);
    fireEvent.click(screen.getByTestId('service-sandbox-link-team-b-agent'));
    expect(onSelectSandbox).toHaveBeenCalledWith('team-b', 'agent', 'services');
    // The router was left alone.
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/all-workspaces$/,
    );
  });

  // The gateway answers these lists for platform admins only. The page does
  // not second-guess it: the refusal is shown as the gateway worded it, and
  // the other lists are their own requests.
  it("shows the gateway's refusal as it is", () => {
    mockUseAllProviders.mockReturnValue(
      failed("role 'openshell-admin' required"),
    );
    renderPage();

    const alert = screen.getByTestId('all-providers-error');
    expect(alert).toHaveTextContent('Failed to load providers');
    expect(alert).toHaveTextContent("role 'openshell-admin' required");
    expect(screen.queryByTestId('all-providers-table')).not.toBeInTheDocument();
    openTab(/Templates/);
    expect(rowsOf('all-templates-table')).toHaveLength(2);
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
