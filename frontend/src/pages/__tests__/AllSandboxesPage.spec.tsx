import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AllSandboxesPage from '../AllSandboxesPage';
import type { Sandbox } from '../../types';

// The page lists the gateway's pages of sandboxes (AllSandboxList). The
// fixtures are written as whole lists, and pagedResult serves them a page at
// a time, the way main's tests of the same list do.
jest.mock('../../api/allWorkspaces', () => ({
  useAllSandboxes: jest.fn(),
  useAllSandboxPage: jest.fn(),
}));

import { useAllSandboxes, useAllSandboxPage } from '../../api/allWorkspaces';
import { pagedResult } from './pagedHookMock';
const mockUseAllSandboxes = useAllSandboxes as jest.Mock;
const mockUseAllSandboxPage = useAllSandboxPage as jest.Mock;

beforeEach(() => {
  mockUseAllSandboxPage.mockImplementation((request) =>
    pagedResult(mockUseAllSandboxes(request.labelSelector), request),
  );
});

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

const renderPage = () =>
  render(
    <MemoryRouter
      initialEntries={['/sandboxes']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AllSandboxesPage />
      <Location />
    </MemoryRouter>,
  );

const headersOf = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('columnheader')
    .map((header) => header.textContent);

const rowsOf = (testId: string) =>
  within(screen.getByTestId(testId)).getAllByRole('row').slice(1);

describe('AllSandboxesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAllSandboxes.mockReturnValue(ok(sandboxes));
  });

  // Name leads so the sandbox is what the row is about; workspace follows.
  it('lists the sandboxes of every workspace with a workspace column', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Sandboxes' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Secure execution environments, across every workspace on the gateway.',
      ),
    ).toBeInTheDocument();
    expect(headersOf('all-sandboxes-table')).toEqual([
      'Name',
      'Workspace',
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
      ['agent', 'team-a', 'READY'],
      ['agent', 'team-b', 'STOPPED'],
      ['builder', 'team-b', 'ERROR'],
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

  // A row leads to the workspace-scoped page of the sandbox it is: the one in
  // its own workspace, not another of the same name. Both names are links,
  // so they can be opened in a new tab and read as links by a screen reader.
  it('opens a sandbox in the workspace it belongs to', () => {
    renderPage();
    const link = screen.getByTestId('sandbox-link-team-b/agent');
    expect(link).toHaveAttribute('href', '/workspaces/team-b/sandboxes/agent');

    fireEvent.click(link);

    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-b\/sandboxes\/agent$/,
    );
  });

  it('opens the workspace from the workspace column', () => {
    renderPage();
    const firstRow = rowsOf('all-sandboxes-table')[0];
    const link = within(firstRow).getByRole('link', { name: 'team-a' });
    expect(link).toHaveAttribute('href', '/workspaces/team-a');

    fireEvent.click(link);

    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/workspaces\/team-a$/,
    );
  });

  // A name is one path segment, whatever it holds.
  it('encodes the names in the paths it links to', () => {
    mockUseAllSandboxes.mockReturnValue(
      ok([sandbox('team a', 'x?y', 'READY')]),
    );
    renderPage();

    expect(screen.getByTestId('sandbox-link-team a/x?y')).toHaveAttribute(
      'href',
      '/workspaces/team%20a/sandboxes/x%3Fy',
    );
    expect(screen.getByTestId('workspace-link-team a/x?y')).toHaveAttribute(
      'href',
      '/workspaces/team%20a',
    );
  });

  // The text filter narrows the page on screen; the gateway pages the list.
  it('filters the rows by workspace or name as it is typed', () => {
    renderPage();
    const filter = screen.getByRole('textbox', {
      name: 'Filter current page of sandboxes',
    });

    fireEvent.change(filter, { target: { value: 'team-b' } });
    expect(rowsOf('all-sandboxes-table')).toHaveLength(2);

    fireEvent.change(filter, { target: { value: 'team-b/build' } });
    const rows = rowsOf('all-sandboxes-table');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('builder');

    fireEvent.change(filter, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No sandboxes match on this page.')).toBeVisible();
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
  });

  it('adds the type label to the label selector it asks the gateway for', () => {
    renderPage();
    const selector = screen.getByRole('textbox', {
      name: 'Filter sandboxes by label selector',
    });
    fireEvent.change(selector, { target: { value: 'team=ml' } });
    fireEvent.keyDown(selector, { key: 'Enter' });
    const type = screen.getByRole('textbox', {
      name: 'Filter sandboxes by type label',
    });
    fireEvent.change(type, { target: { value: 'type=tool' } });
    fireEvent.keyDown(type, { key: 'Enter' });
    expect(mockUseAllSandboxPage).toHaveBeenLastCalledWith({
      pageSize: 10,
      pageToken: '',
      labelSelector: 'team=ml,type=tool',
    });
  });

  it('keeps the type field visible when its selector matches no sandboxes', () => {
    mockUseAllSandboxes.mockImplementation((selector?: string) =>
      ok(selector === 'type=tool' ? [] : sandboxes),
    );
    renderPage();
    const type = screen.getByRole('textbox', {
      name: 'Filter sandboxes by type label',
    });
    fireEvent.change(type, { target: { value: 'type=tool' } });
    fireEvent.keyDown(type, { key: 'Enter' });
    expect(screen.getByTestId('all-sandboxes-table')).toBeInTheDocument();
    expect(type).toHaveValue('type=tool');
    expect(screen.queryByTestId('all-sandboxes-empty')).not.toBeInTheDocument();
  });

  it('rejects a conflicting type key without changing the request', () => {
    renderPage();
    const selector = screen.getByRole('textbox', {
      name: 'Filter sandboxes by label selector',
    });
    fireEvent.change(selector, { target: { value: 'type=agent' } });
    fireEvent.keyDown(selector, { key: 'Enter' });
    const type = screen.getByRole('textbox', {
      name: 'Filter sandboxes by type label',
    });
    fireEvent.change(type, { target: { value: 'type=tool' } });
    fireEvent.keyDown(type, { key: 'Enter' });
    expect(
      screen.getByTestId('all-sandboxes-type-label-error'),
    ).toHaveTextContent('already uses type');
    expect(mockUseAllSandboxPage).toHaveBeenLastCalledWith({
      pageSize: 10,
      pageToken: '',
      labelSelector: 'type=agent',
    });
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

  // The gateway answers this list for platform admins only. The page does
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
});
