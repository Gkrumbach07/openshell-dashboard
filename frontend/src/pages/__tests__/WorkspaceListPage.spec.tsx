import React from 'react';
import {
  fireEvent,
  render as renderBare,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceListPage from '../WorkspaceListPage';
import type { Workspace } from '../../types';

jest.mock('../../api/workspaces', () => ({
  useWorkspaces: jest.fn(),
  deleteWorkspace: jest.fn(),
  useDeleteWorkspace: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useCreateWorkspace: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

let mockIsPlatformAdmin = true;
jest.mock('../../api/rbac', () => ({
  useUserRole: jest.fn(() => ({ isPlatformAdmin: mockIsPlatformAdmin })),
}));

const mockAddSuccess = jest.fn();
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: mockAddSuccess })),
}));

import { deleteWorkspace, useWorkspaces } from '../../api/workspaces';
const mockUseWorkspaces = useWorkspaces as jest.Mock;
const mockDeleteWorkspace = deleteWorkspace as jest.Mock;

// The page deletes through the query client (it invalidates the lists a
// deleted workspace was in), so it is rendered inside one. The list itself is
// served by the mock above and never reaches it.
let queryClient: QueryClient;
const render = (ui: React.ReactElement) => {
  queryClient = new QueryClient();
  jest.spyOn(queryClient, 'invalidateQueries');
  return renderBare(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

const workspace = (
  name: string,
  labels?: Record<string, string>,
): Workspace => ({
  metadata: {
    id: `id-${name}`,
    name,
    labels,
    createdAtMs: Date.now() - 3_600_000,
    resourceVersion: 1,
  },
  phase: 'ACTIVE',
});

const all = [
  workspace('default'),
  workspace('staging', { env: 'staging', owner: 'ml' }),
  workspace('prod', { env: 'prod' }),
];

// The list as the gateway filters it: the hook is called with the selector
// that was applied and answers with the matching workspaces.
const serve = (bySelector: Record<string, Workspace[] | Error>) =>
  mockUseWorkspaces.mockImplementation((selector?: string) => {
    const answer = bySelector[selector ?? ''] ?? [];
    return answer instanceof Error
      ? { isLoading: false, isError: true, error: answer, data: undefined }
      : { isLoading: false, isError: false, data: answer, refetch: jest.fn() };
  });

const filterBox = () =>
  screen.getByRole('textbox', { name: 'Filter workspaces by label selector' });

const applyFilter = (selector: string) => {
  fireEvent.change(filterBox(), { target: { value: selector } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply label filter' }));
};

const listedNames = () =>
  within(screen.getByTestId('workspace-table'))
    .queryAllByTestId(/^workspace-link-/)
    .map((link) => link.textContent);

describe('WorkspaceListPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = true;
  });

  it('lists every workspace with its labels until a filter is applied', () => {
    serve({ '': all });
    render(<WorkspaceListPage />);

    expect(mockUseWorkspaces).toHaveBeenLastCalledWith(undefined);
    expect(listedNames()).toEqual(['default', 'staging', 'prod']);
    const staging = screen.getByTestId('workspace-link-staging').closest('tr');
    expect(staging).toHaveTextContent('env=staging');
    expect(staging).toHaveTextContent('owner=ml');
  });

  // `openshell workspace list --label-selector env=staging`: the gateway does
  // the filtering, so the selector goes to the list request as it was typed.
  it('asks the gateway for the label selector that is submitted', () => {
    serve({ '': all, 'env=staging': [all[1]] });
    render(<WorkspaceListPage />);

    applyFilter('env=staging');

    expect(mockUseWorkspaces).toHaveBeenLastCalledWith('env=staging');
    expect(listedNames()).toEqual(['staging']);
  });

  it('does not filter on every key that is typed', () => {
    serve({ '': all });
    render(<WorkspaceListPage />);

    fireEvent.change(filterBox(), { target: { value: 'env=st' } });

    expect(mockUseWorkspaces).toHaveBeenLastCalledWith(undefined);
    expect(listedNames()).toEqual(['default', 'staging', 'prod']);
  });

  it('applies the selector when Enter is pressed', () => {
    serve({ '': all, 'env=prod': [all[2]] });
    render(<WorkspaceListPage />);

    fireEvent.change(filterBox(), { target: { value: ' env=prod ' } });
    fireEvent.keyDown(filterBox(), { key: 'Enter' });

    // Trimmed: the spaces around it are not part of the selector.
    expect(mockUseWorkspaces).toHaveBeenLastCalledWith('env=prod');
    expect(listedNames()).toEqual(['prod']);
  });

  it('goes back to every workspace when the filter is cleared', () => {
    serve({ '': all, 'env=staging': [all[1]] });
    render(<WorkspaceListPage />);
    applyFilter('env=staging');

    fireEvent.click(screen.getByRole('button', { name: 'Clear label filter' }));

    expect(mockUseWorkspaces).toHaveBeenLastCalledWith(undefined);
    expect(listedNames()).toEqual(['default', 'staging', 'prod']);
    expect(filterBox()).toHaveValue('');
  });

  // The page's own empty state is for a gateway without workspaces. A filter
  // that matches nothing keeps the filter on screen to be changed.
  it('keeps the filter and says so when nothing matches', () => {
    serve({ '': all, 'env=dev': [] });
    render(<WorkspaceListPage />);

    applyFilter('env=dev');

    expect(
      screen.getByText('No workspaces match this label selector.'),
    ).toBeInTheDocument();
    expect(filterBox()).toHaveValue('env=dev');
    expect(screen.queryByText('No workspaces')).not.toBeInTheDocument();
  });

  // The gateway refuses a selector that is not key=value pairs. Its message
  // is shown beside the box, which stays where it is to be corrected.
  it('shows the refusal of a malformed selector beside the filter', () => {
    serve({
      '': all,
      env: new Error("invalid label selector: expected 'key=value', got 'env'"),
    });
    render(<WorkspaceListPage />);

    applyFilter('env');

    const alert = screen.getByTestId('workspace-label-filter-error');
    expect(alert).toHaveTextContent('The label selector could not be applied');
    expect(alert).toHaveTextContent(
      "invalid label selector: expected 'key=value', got 'env'",
    );
    expect(filterBox()).toHaveValue('env');
    expect(
      screen.queryByText('No workspaces match this label selector.'),
    ).not.toBeInTheDocument();
  });

  it('replaces the page with the error when the unfiltered list fails', () => {
    serve({ '': new Error('gateway unreachable') });
    render(<WorkspaceListPage />);

    expect(screen.getByText('Failed to load workspaces')).toBeInTheDocument();
    expect(screen.getByText('gateway unreachable')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-table')).not.toBeInTheDocument();
  });

  it('shows the empty state only when the gateway has no workspaces', () => {
    serve({ '': [] });
    render(<WorkspaceListPage />);

    expect(screen.getByText('No workspaces')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-table')).not.toBeInTheDocument();
  });

  it('lets a user who is not a platform admin filter too', () => {
    mockIsPlatformAdmin = false;
    serve({ '': all, 'env=staging': [all[1]] });
    render(<WorkspaceListPage />);

    expect(screen.queryByTestId('create-workspace')).not.toBeInTheDocument();
    applyFilter('env=staging');
    expect(listedNames()).toEqual(['staging']);
  });

  it('opens a workspace through onSelect', () => {
    serve({ '': all });
    const onSelect = jest.fn();
    render(<WorkspaceListPage onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('workspace-link-staging'));

    expect(onSelect).toHaveBeenCalledWith('staging');
  });
});

// `openshell workspace delete <names...>` takes several names. The page
// deleted one workspace at a time.
describe('WorkspaceListPage delete', () => {
  // The checkbox of a row. PatternFly names them by their place on the page.
  const rowCheckbox = (name: string) =>
    within(
      screen.getByTestId(`workspace-link-${name}`).closest('tr') as HTMLElement,
    ).getByRole('checkbox');
  const select = (...names: string[]) =>
    names.forEach((name) => fireEvent.click(rowCheckbox(name)));
  const openActions = () =>
    fireEvent.click(screen.getByTestId('workspace-actions-kebab'));
  // The menu item itself: the test id is on the list item around it.
  const deleteSelected = () =>
    within(screen.getByTestId('delete-selected-workspaces')).getByRole(
      'menuitem',
    );
  const openDeleteSelected = () => {
    openActions();
    fireEvent.click(deleteSelected());
  };
  const rowDelete = (name: string) => {
    fireEvent.click(
      within(
        screen
          .getByTestId(`workspace-link-${name}`)
          .closest('tr') as HTMLElement,
      ).getByRole('button', { name: 'Kebab toggle' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  };
  const typeToConfirm = (text: string) =>
    fireEvent.change(screen.getByTestId('confirm-delete-name-input'), {
      target: { value: text },
    });
  const confirm = () => screen.getByTestId('confirm-delete');
  const dialog = () => screen.getByRole('dialog');
  const invalidated = () =>
    (queryClient.invalidateQueries as jest.Mock).mock.calls.map(
      ([filters]) => filters.queryKey,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = true;
    mockDeleteWorkspace.mockReset();
    mockDeleteWorkspace.mockResolvedValue({
      deleted: true,
      outcome: 'completed',
    });
    serve({ '': all, 'env=staging': [all[1]] });
  });

  it('lets a platform admin select workspaces', () => {
    render(<WorkspaceListPage />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(rowCheckbox('staging')).not.toBeChecked();
    expect(screen.getByTestId('workspace-actions-kebab')).toBeInTheDocument();

    select('staging');
    expect(rowCheckbox('staging')).toBeChecked();
    expect(rowCheckbox('prod')).not.toBeChecked();
  });

  // The gateway deletes a workspace for a platform admin only.
  it('offers nobody else anything to select or delete', () => {
    mockIsPlatformAdmin = false;
    render(<WorkspaceListPage />);

    expect(listedNames()).toEqual(['default', 'staging', 'prod']);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workspace-actions-kebab'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Kebab toggle' }),
    ).not.toBeInTheDocument();
  });

  it('has nothing to delete until something is selected', () => {
    render(<WorkspaceListPage />);

    openActions();

    expect(deleteSelected()).toHaveTextContent('Delete selected');
    expect(deleteSelected()).not.toHaveTextContent('(');
    expect(deleteSelected()).toBeDisabled();
  });

  it('deletes the selected workspaces once the phrase is typed', async () => {
    render(<WorkspaceListPage />);
    select('staging', 'prod');
    openActions();
    expect(deleteSelected()).toHaveTextContent('Delete selected (2)');

    fireEvent.click(deleteSelected());

    // Every workspace that will go is named, and what goes with it.
    expect(dialog()).toHaveTextContent('Delete 2 workspaces?');
    expect(dialog()).toHaveTextContent(
      'These workspaces and everything in them (sandboxes, providers, members) will be deleted: "staging", "prod".',
    );
    expect(dialog()).toHaveTextContent('Type "delete 2 workspaces" to confirm');
    // Nothing happens before the phrase is typed, and typed right.
    expect(confirm()).toBeDisabled();
    typeToConfirm('delete 3 workspaces');
    expect(confirm()).toBeDisabled();
    typeToConfirm('delete 2 workspaces');
    expect(confirm()).toBeEnabled();
    expect(mockDeleteWorkspace).not.toHaveBeenCalled();

    fireEvent.click(confirm());

    await waitFor(() =>
      expect(mockAddSuccess).toHaveBeenCalledWith('2 workspaces deleted'),
    );
    expect(mockDeleteWorkspace.mock.calls.map(([name]) => name)).toEqual([
      'staging',
      'prod',
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // The list, and the lists across workspaces, are read again.
    expect(invalidated()).toEqual(
      expect.arrayContaining([['workspaces'], ['all-workspaces']]),
    );
    // Nothing stays selected.
    expect(rowCheckbox('staging')).not.toBeChecked();
    expect(rowCheckbox('default')).not.toBeChecked();
  });

  // One workspace keeps the confirmation it always had: its name, typed.
  it('asks for the name of a single workspace', async () => {
    render(<WorkspaceListPage />);

    rowDelete('staging');

    expect(dialog()).toHaveTextContent('Delete workspace?');
    expect(dialog()).toHaveTextContent(
      'Workspace "staging" and everything in it (sandboxes, providers, members) will be deleted.',
    );
    expect(dialog()).toHaveTextContent('Type "staging" to confirm');
    expect(confirm()).toBeDisabled();
    typeToConfirm('staging');
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(mockAddSuccess).toHaveBeenCalledWith(
        'Workspace "staging" deleted',
      ),
    );
    expect(mockDeleteWorkspace.mock.calls).toEqual([['staging']]);
    expect(invalidated()).toEqual(
      expect.arrayContaining([['workspaces'], ['all-workspaces']]),
    );
  });

  it('asks for the name when one workspace is selected, too', () => {
    render(<WorkspaceListPage />);
    select('prod');

    openDeleteSelected();

    expect(dialog()).toHaveTextContent('Delete workspace?');
    expect(dialog()).toHaveTextContent('Type "prod" to confirm');
    typeToConfirm('delete 1 workspaces');
    expect(confirm()).toBeDisabled();
  });

  it('selects every workspace on the page at once', () => {
    render(<WorkspaceListPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    openDeleteSelected();

    expect(dialog()).toHaveTextContent('Delete 3 workspaces?');
    expect(dialog()).toHaveTextContent('"default", "staging", "prod"');
    expect(dialog()).toHaveTextContent('Type "delete 3 workspaces" to confirm');
  });

  // The gateway gives a reason for each workspace it does not delete.
  it('says which workspaces were not deleted and why, and asks again about those alone', async () => {
    mockDeleteWorkspace.mockImplementation((name: string) =>
      name === 'staging'
        ? Promise.resolve({ deleted: true, outcome: 'completed' })
        : Promise.reject(new Error(`workspace '${name}' has active sandboxes`)),
    );
    render(<WorkspaceListPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    openDeleteSelected();
    typeToConfirm('delete 3 workspaces');

    fireEvent.click(confirm());

    await waitFor(() =>
      expect(dialog()).toHaveTextContent('Delete 2 workspaces?'),
    );
    expect(dialog()).toHaveTextContent('"default", "prod"');
    expect(dialog()).not.toHaveTextContent('"staging"');
    expect(dialog()).toHaveTextContent(
      "default: workspace 'default' has active sandboxes; prod: workspace 'prod' has active sandboxes",
    );
    // The one that went through is reported, and is not asked about again.
    expect(mockAddSuccess).toHaveBeenCalledTimes(1);
    expect(mockAddSuccess).toHaveBeenCalledWith('Workspaces deleted: staging');
    // What was typed was for three workspaces. It does not confirm two.
    expect(screen.getByTestId('confirm-delete-name-input')).toHaveValue('');
    expect(confirm()).toBeDisabled();
    expect(invalidated()).toEqual(
      expect.arrayContaining([['workspaces'], ['all-workspaces']]),
    );
  });

  it('shows the reason as the gateway gave it when a single delete is refused', async () => {
    mockDeleteWorkspace.mockRejectedValue(
      new Error("workspace 'default' cannot be deleted"),
    );
    render(<WorkspaceListPage />);
    rowDelete('default');
    typeToConfirm('default');

    fireEvent.click(confirm());

    await waitFor(() =>
      expect(dialog()).toHaveTextContent(
        "workspace 'default' cannot be deleted",
      ),
    );
    expect(dialog()).not.toHaveTextContent('default: workspace');
    expect(dialog()).toHaveTextContent('Delete workspace?');
    expect(mockAddSuccess).not.toHaveBeenCalled();
    // The same workspace, so what was typed still stands for a second try.
    expect(confirm()).toBeEnabled();
  });

  it('comes down to one workspace, and its name, when only one was refused', async () => {
    mockDeleteWorkspace.mockImplementation((name: string) =>
      name === 'prod'
        ? Promise.reject(new Error('permission denied'))
        : Promise.resolve({ deleted: true, outcome: 'completed' }),
    );
    render(<WorkspaceListPage />);
    select('staging', 'prod');
    openDeleteSelected();
    typeToConfirm('delete 2 workspaces');

    fireEvent.click(confirm());

    await waitFor(() =>
      expect(dialog()).toHaveTextContent('Delete workspace?'),
    );
    expect(dialog()).toHaveTextContent('Type "prod" to confirm');
    expect(dialog()).toHaveTextContent('permission denied');
    expect(confirm()).toBeDisabled();
  });

  // What was typed to confirm one delete must never stand for the next.
  it('starts every confirmation empty', async () => {
    render(<WorkspaceListPage />);
    rowDelete('staging');
    typeToConfirm('staging');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The same workspace again, after a cancel.
    rowDelete('staging');
    expect(screen.getByTestId('confirm-delete-name-input')).toHaveValue('');
    expect(confirm()).toBeDisabled();
    typeToConfirm('staging');
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    // And again after a delete that went through.
    rowDelete('staging');
    expect(screen.getByTestId('confirm-delete-name-input')).toHaveValue('');
    expect(confirm()).toBeDisabled();
  });

  it('deletes nothing when the confirmation is cancelled', () => {
    render(<WorkspaceListPage />);
    select('staging', 'prod');
    openDeleteSelected();
    typeToConfirm('delete 2 workspaces');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockDeleteWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The selection is still there to act on.
    expect(rowCheckbox('staging')).toBeChecked();
  });

  // A workspace the filter hides would be deleted without being on screen.
  it('forgets the selection when the label filter changes', () => {
    render(<WorkspaceListPage />);
    select('staging', 'prod');

    applyFilter('env=staging');

    expect(rowCheckbox('staging')).not.toBeChecked();
    openActions();
    expect(deleteSelected()).toBeDisabled();
  });

  // The list refreshes by itself. A workspace somebody else deleted in the
  // meantime is not one of the selected any more.
  it('does not delete a selected workspace that is no longer listed', () => {
    const { rerender } = render(<WorkspaceListPage />);
    select('staging', 'prod');

    serve({ '': [all[0], all[2]] });
    rerender(<WorkspaceListPage />);
    openDeleteSelected();

    expect(dialog()).toHaveTextContent('Delete workspace?');
    expect(dialog()).toHaveTextContent('Type "prod" to confirm');
    expect(dialog()).not.toHaveTextContent('staging');
  });
});

// The list is re-read while the page is open.
describe('WorkspaceListPage when a refresh fails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = true;
  });

  it('keeps the workspaces that loaded and says the refresh failed', () => {
    const refetch = jest.fn();
    mockUseWorkspaces.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('OpenShell gateway is unreachable'),
      data: all,
      refetch,
    });
    render(<WorkspaceListPage />);

    const notice = screen.getByTestId('workspace-refresh-error');
    expect(notice).toHaveTextContent(
      'The workspace list could not be refreshed',
    );
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    expect(notice).toHaveTextContent(
      'The workspaces shown were loaded earlier and may be out of date.',
    );
    expect(listedNames()).toEqual(['default', 'staging', 'prod']);
    expect(screen.queryByText('Failed to load workspaces')).toBeNull();

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // The rows of the last filter, kept on screen while the next one loads,
  // are not what a list that failed to load has: that is still a failure of
  // the filter, shown beside it.
  it('does not take rows it only holds for another filter as its own', () => {
    mockUseWorkspaces.mockImplementation((selector?: string) =>
      selector
        ? {
            isLoading: false,
            isError: true,
            error: new Error("invalid label selector: expected 'key=value'"),
            data: all,
            isPlaceholderData: true,
            refetch: jest.fn(),
          }
        : { isLoading: false, isError: false, data: all, refetch: jest.fn() },
    );
    render(<WorkspaceListPage />);

    applyFilter('env');

    expect(
      screen.getByTestId('workspace-label-filter-error'),
    ).toHaveTextContent("invalid label selector: expected 'key=value'");
    expect(
      screen.queryByTestId('workspace-refresh-error'),
    ).not.toBeInTheDocument();
  });

  it('says nothing of the kind while refreshes succeed', () => {
    serve({ '': all });
    render(<WorkspaceListPage />);

    expect(
      screen.queryByTestId('workspace-refresh-error'),
    ).not.toBeInTheDocument();
  });
});

// The list is polled, and workspaces are deleted here and elsewhere: the page
// a reader is on can cease to exist.
describe('WorkspaceListPage when the list shrinks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlatformAdmin = true;
  });

  const many = (count: number) =>
    Array.from({ length: count }, (_unused, index) =>
      workspace(`ws-${String(index + 1).padStart(2, '0')}`),
    );

  const serveList = (listed: () => Workspace[]) =>
    mockUseWorkspaces.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      data: listed(),
      refetch: jest.fn(),
    }));

  it('goes back to the last page that has rows', () => {
    let listed = many(11);
    serveList(() => listed);
    const view = render(<WorkspaceListPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(listedNames()).toEqual(['ws-11']);

    // The one workspace on the second page is deleted, here or elsewhere.
    listed = many(10);
    view.rerender(<WorkspaceListPage />);

    expect(listedNames()).toHaveLength(10);
    expect(listedNames()).toContain('ws-01');
  });

  // No selector was applied, so nothing can have failed to match one.
  it('does not speak of a label selector when none is applied', () => {
    let listed = many(11);
    serveList(() => listed);
    const view = render(<WorkspaceListPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));

    listed = many(10);
    view.rerender(<WorkspaceListPage />);

    expect(
      screen.queryByText('No workspaces match this label selector.'),
    ).not.toBeInTheDocument();
  });

  it('still says so when a selector that is applied matches nothing', () => {
    serve({ '': all, 'env=none': [] });
    render(<WorkspaceListPage />);

    applyFilter('env=none');

    expect(
      screen.getByText('No workspaces match this label selector.'),
    ).toBeVisible();
  });
});
