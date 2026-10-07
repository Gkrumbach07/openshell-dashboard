import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ResourceTable from '../ResourceTable';
import type {
  ResourceTableColumn,
  ResourceTableLabelSelector,
  ResourceTableQuery,
} from '../ResourceTable';

type Item = { workspace: string; name: string };

const items = (count: number): Item[] =>
  Array.from({ length: count }, (_unused, index) => ({
    workspace: index % 2 === 0 ? 'team-a' : 'team-b',
    name: `item-${String(index + 1).padStart(2, '0')}`,
  }));

const columns: ResourceTableColumn<Item>[] = [
  { title: 'Workspace', render: (item) => item.workspace },
  { title: 'Name', render: (item) => item.name },
];

const query = (
  overrides: Partial<ResourceTableQuery<Item>> = {},
): ResourceTableQuery<Item> => ({
  data: items(3),
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  ...overrides,
});

const table = (
  tableQuery: ResourceTableQuery<Item>,
  labelSelector?: ResourceTableLabelSelector,
) => (
  <ResourceTable
    title="Things"
    testId="things"
    query={tableQuery}
    columns={columns}
    rowKey={(item) => `${item.workspace}/${item.name}`}
    filterText={(item) => `${item.workspace}/${item.name}`}
    filterPlaceholder="Filter by workspace or name"
    emptyBody="Nothing here yet."
    labelSelector={labelSelector}
  />
);

const renderTable = (
  tableQuery: ResourceTableQuery<Item>,
  labelSelector?: ResourceTableLabelSelector,
) => render(table(tableQuery, labelSelector));

const names = () =>
  within(screen.getByTestId('things-table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent);

describe('ResourceTable', () => {
  it('renders a column for each definition and a row for each item', () => {
    renderTable(query());

    const table = within(screen.getByTestId('things-table'));
    expect(
      table.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual(['Workspace', 'Name']);
    expect(names()).toEqual(['item-01', 'item-02', 'item-03']);
    expect(screen.getByRole('grid', { name: 'Things' })).toBeInTheDocument();
  });

  it('shows a spinner while the first answer is on its way', () => {
    renderTable(query({ data: undefined, isLoading: true }));

    expect(screen.getByLabelText('Loading things')).toBeInTheDocument();
    expect(screen.queryByTestId('things-table')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is nothing and no filter', () => {
    renderTable(query({ data: [] }));

    const empty = screen.getByTestId('things-empty');
    expect(empty).toHaveTextContent('No things');
    expect(empty).toHaveTextContent('Nothing here yet.');
    expect(screen.queryByTestId('things-table')).not.toBeInTheDocument();
  });

  it('shows the error with a way to retry', () => {
    const refetch = jest.fn();
    renderTable(
      query({
        data: undefined,
        isError: true,
        error: new Error("role 'openshell-admin' required"),
        refetch,
      }),
    );

    const alert = screen.getByTestId('things-error');
    expect(alert).toHaveTextContent('Failed to load things');
    expect(alert).toHaveTextContent("role 'openshell-admin' required");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // The lists are polled. A poll that fails says nothing about the rows that
  // loaded before: they stay, with what was typed in the filter, and the
  // failure is reported above them.
  it('keeps the rows it has and says so when reading them again failed', () => {
    const refetch = jest.fn();
    renderTable(
      query({
        isError: true,
        error: new Error('OpenShell gateway is unreachable'),
        refetch,
      }),
    );

    const notice = screen.getByTestId('things-refresh-error');
    expect(notice).toHaveTextContent('The things could not be refreshed');
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    expect(names()).toEqual(['item-01', 'item-02', 'item-03']);
    expect(screen.queryByTestId('things-error')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load things')).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the filter that was typed when a poll fails', () => {
    const view = renderTable(query());
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'team-b' },
    });

    view.rerender(
      table(query({ isError: true, error: new Error('gateway away') })),
    );

    expect(screen.getByRole('textbox', { name: 'Filter things' })).toHaveValue(
      'team-b',
    );
    expect(names()).toEqual(['item-02']);
    expect(screen.getByTestId('things-refresh-error')).toBeInTheDocument();
  });

  it('says so above the empty state when a list that was empty cannot be read again', () => {
    renderTable(
      query({ data: [], isError: true, error: new Error('gateway away') }),
    );

    expect(screen.getByTestId('things-refresh-error')).toHaveTextContent(
      'gateway away',
    );
    expect(screen.getByTestId('things-empty')).toBeInTheDocument();
  });

  // A selector that was applied and answered is not what failed when a later
  // poll of the same list does.
  it('does not blame the label selector for a poll that failed', () => {
    renderTable(query({ isError: true, error: new Error('gateway away') }), {
      value: 'team=ml',
      onApply: jest.fn(),
    });

    expect(screen.getByTestId('things-refresh-error')).toBeInTheDocument();
    expect(
      screen.queryByText('The label selector could not be applied'),
    ).not.toBeInTheDocument();
    expect(names()).toEqual(['item-01', 'item-02', 'item-03']);
  });

  // The rows of the last selector, kept on screen while the next one loads,
  // are not what a list that failed to load has.
  it('does not take rows it only holds for another selector as its own', () => {
    renderTable(
      query({
        isError: true,
        isPlaceholderData: true,
        error: new Error("expected 'key=value', got 'team'"),
      }),
      { value: 'team', onApply: jest.fn() },
    );

    expect(screen.getByTestId('things-error')).toHaveTextContent(
      'The label selector could not be applied',
    );
    expect(
      screen.queryByTestId('things-refresh-error'),
    ).not.toBeInTheDocument();
  });

  it('filters on the text each row is matched on, ignoring case', () => {
    renderTable(query());

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'TEAM-B' },
    });

    expect(names()).toEqual(['item-02']);
  });

  it('says so when the filter matches nothing', () => {
    renderTable(query());

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText('No things match this filter.')).toBeVisible();
  });

  it('pages through more rows than fit, and filters across pages', () => {
    renderTable(query({ data: items(12) }));

    expect(names()).toHaveLength(10);
    expect(names()).not.toContain('item-11');

    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(names()).toEqual(['item-11', 'item-12']);

    // A row on the first page is found from the second: filtering starts
    // over at page one.
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'item-03' },
    });
    expect(names()).toEqual(['item-03']);
  });

  // The lists are polled, and rows are deleted elsewhere: the page a reader
  // is on can cease to exist. The reader is then shown the last page that
  // has rows, and is not told that nothing matches a selector nobody typed.
  it('goes back to the last page that has rows when the list shrinks', () => {
    const view = renderTable(query({ data: items(11) }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(names()).toEqual(['item-11']);

    view.rerender(table(query({ data: items(10) })));

    expect(names()).toHaveLength(10);
    expect(names()).toContain('item-01');
    expect(
      screen.queryByText(/No things match this label selector/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No things match this filter/),
    ).not.toBeInTheDocument();
  });

  it('does the same when a filter leaves fewer pages', () => {
    const view = renderTable(query({ data: items(25) }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(names()).toEqual([
      'item-21',
      'item-22',
      'item-23',
      'item-24',
      'item-25',
    ]);

    view.rerender(table(query({ data: items(12) })));

    expect(names()).toEqual(['item-11', 'item-12']);
  });

  // A column says how its cells wrap, so that one long value (an image
  // pinned by digest) is cut short instead of pushing the others off screen.
  it('applies a column modifier to its header and its cells only', () => {
    render(
      <ResourceTable
        title="Things"
        testId="things"
        query={query()}
        columns={[
          { ...columns[0], modifier: 'nowrap' },
          { ...columns[1], modifier: 'truncate' },
          { title: 'Plain', render: () => 'plain' },
        ]}
        rowKey={(item) => `${item.workspace}/${item.name}`}
        filterText={(item) => item.name}
        filterPlaceholder="Filter"
        emptyBody="Nothing here yet."
      />,
    );

    const table = within(screen.getByTestId('things-table'));
    const classesOf = (cells: HTMLElement[]) =>
      cells.map((cell) =>
        ['pf-m-nowrap', 'pf-m-truncate'].filter((name) =>
          cell.classList.contains(name),
        ),
      );
    expect(classesOf(table.getAllByRole('columnheader'))).toEqual([
      ['pf-m-nowrap'],
      ['pf-m-truncate'],
      [],
    ]);
    const firstRow = table.getAllByRole('row')[1];
    expect(classesOf(within(firstRow).getAllByRole('cell'))).toEqual([
      ['pf-m-nowrap'],
      ['pf-m-truncate'],
      [],
    ]);
  });

  it('has no label selector box unless it is given one', () => {
    renderTable(query());
    expect(
      screen.queryByRole('textbox', {
        name: 'Filter things by label selector',
      }),
    ).not.toBeInTheDocument();
  });

  it('applies the label selector on submit and on clear, trimmed', () => {
    const onApply = jest.fn();
    renderTable(query(), { value: '', onApply });
    const box = screen.getByRole('textbox', {
      name: 'Filter things by label selector',
    });

    fireEvent.change(box, { target: { value: ' team=ml ' } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply label selector' }),
    );
    expect(onApply).toHaveBeenLastCalledWith('team=ml');

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear label selector' }),
    );
    expect(onApply).toHaveBeenLastCalledWith('');
    expect(box).toHaveValue('');
  });

  // With a selector applied an empty or failed answer is about the selector,
  // so the box stays on screen to be changed.
  it('keeps the selector box when the selector matches nothing', () => {
    renderTable(query({ data: [] }), {
      value: 'team=none',
      onApply: jest.fn(),
    });

    expect(screen.queryByTestId('things-empty')).not.toBeInTheDocument();
    expect(
      screen.getByText('No things match this label selector.'),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Filter things by label selector' }),
    ).toHaveValue('team=none');
  });

  // With both a selector and a filter, nothing at all came back for the
  // selector: the filter had nothing to leave out.
  it('says the selector matched nothing when it is the selector that did', () => {
    renderTable(query({ data: [] }), {
      value: 'team=none',
      onApply: jest.fn(),
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'item' },
    });

    expect(
      screen.getByText('No things match this label selector.'),
    ).toBeVisible();
  });

  it('says the filter matched nothing when the selector did match', () => {
    renderTable(query(), { value: 'team=ml', onApply: jest.fn() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter things' }), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText('No things match this filter.')).toBeVisible();
  });

  it('keeps the selector box when the gateway refuses the selector', () => {
    renderTable(
      query({
        data: undefined,
        isError: true,
        error: new Error("expected 'key=value', got 'team'"),
      }),
      { value: 'team', onApply: jest.fn() },
    );

    const alert = screen.getByTestId('things-error');
    expect(alert).toHaveTextContent('The label selector could not be applied');
    expect(alert).toHaveTextContent("expected 'key=value', got 'team'");
    expect(
      screen.getByRole('textbox', { name: 'Filter things by label selector' }),
    ).toHaveValue('team');
    expect(
      screen.queryByText('No things match this label selector.'),
    ).not.toBeInTheDocument();
  });
});
